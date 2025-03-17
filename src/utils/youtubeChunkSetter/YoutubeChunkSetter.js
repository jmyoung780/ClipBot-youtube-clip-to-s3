const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const path = require('path');
const { generateUploadURL } = require('../S3');

function secondsToTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    const formattedHours = hours.toString().padStart(2, '0');
    const formattedMinutes = minutes.toString().padStart(2, '0');
    const formattedSeconds = remainingSeconds.toString().padStart(2, '0');
    return `${formattedHours}:${formattedMinutes}:${formattedSeconds}.000`;
}

// Helper function to convert ffmpeg timemark to seconds
function convertTimemarkToSeconds(timemark) {
    const parts = timemark.split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parseFloat(parts[2]);

    return hours * 3600 + minutes * 60 + seconds;
}

// Helper function to upload file to S3 and return URL
async function uploadFileToS3(outputPath) {
    const fileData = fs.readFileSync(outputPath);

    // Get pre-signed URL for upload
    const uploadUrl = await generateUploadURL();
    console.log('Upload URL', uploadUrl);

    // When using pre-signed URLs, don't add any additional headers
    // that weren't part of the signature calculation
    const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileData,
        headers: {
            'Content-Type': 'video/mp4'
        },

        // Don't add any headers - the URL already contains the necessary authentication
        duplex: 'half',
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
        // Log the error response body for debugging
        const errorText = await response.text();
        console.error('S3 upload error:', errorText);
        throw new Error(`S3 upload failed with status ${response.status}: ${errorText}`);
    }

    return uploadUrl.split('?')[0];
}

// Helper function to delete temporary file
function deleteTempFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Temporary file deleted: ${filePath}`);
        }
    } catch (error) {
        console.error(`Error deleting temporary file ${filePath}:`, error);
    }
}

// Helper function to ensure temp directory exists
function ensureTempDirExists(tempDir) {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
}

// Helper function to create FFmpeg command
function createFfmpegCommand(
    stream,
    outputPath,
    start,
    duration
) {
    return ffmpeg(stream)
        .inputFormat('mp4')
        .outputOptions([
            '-ss', secondsToTime(start),
            '-t', duration.toString(),
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-movflags', 'frag_keyframe+empty_moov',
        ])
        .output(outputPath);
}

// The force-kill approach - Uses a temp file and kills process if it takes too long
const YoutubeChunkSetter = async (youtubeUrl, start, end) => {
    // Create unique ID for this download
    const downloadId = Date.now().toString();
    const tempDir = path.join(process.cwd(), 'temp');
    const outputPath = path.join(tempDir, `${downloadId}.mp4`);

    // Ensure temp directory exists
    ensureTempDirExists(tempDir);

    try {
        const duration = end - start;
        console.log(`Starting video processing... Duration: ${duration}s, Start: ${start}s, End: ${end}s`);

        // Get video info
        const info = await ytdl.getInfo(youtubeUrl);
        console.log(`Video info retrieved successfully for ${info.videoDetails.title}`);

        // Create readable stream from YouTube
        const stream = ytdl(youtubeUrl, {
            quality: 'highest',
            filter: 'audioandvideo',
        });

        // Set strict time limits
        const MAX_PROCESS_TIME = Math.max(30000, duration * 1000 * 2); // 30 seconds or 2x duration, whichever is greater
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            let ffmpegProcess = null;
            let isCompleted = false;
            const killTimeout = setTimeout(() => forceTerminate(), MAX_PROCESS_TIME);

            // Force kill function
            const forceTerminate = async () => {
                console.log('Force terminating process - took too long');
                if (ffmpegProcess) {
                    try {
                        // Try different ways to kill the process
                        if (typeof ffmpegProcess.kill === 'function') {
                            ffmpegProcess.kill('SIGKILL');
                        } else if (ffmpegProcess._events && ffmpegProcess._events.error) {
                            // Try to cause an error to trigger process end
                            ffmpegProcess.emit('error', new Error('Force terminated'));
                        }
                    } catch (e) {
                        console.error('Error killing process:', e);
                    }
                }

                if (!isCompleted) {
                    isCompleted = true;

                    // Check if we have at least some output
                    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                        console.log(`Using partial output file of size ${fs.statSync(outputPath).size} bytes`);
                        try {
                            const url = await uploadFileToS3(outputPath);
                            deleteTempFile(outputPath); // Delete temp file after upload
                            resolve(url);
                        } catch (error) {
                            deleteTempFile(outputPath); // Delete temp file even on error
                            reject(new Error('Error reading output file: ' + (error.message || 'Unknown error')));
                        }
                    } else {
                        reject(new Error('Processing timeout - no output file generated'));
                    }
                }
            };

            // Create FFmpeg command with output to file
            const command = createFfmpegCommand(stream, outputPath, start, duration);

            command
                .on('start', function(cmdline) {
                    console.log('Started ffmpeg with command:', cmdline);
                    ffmpegProcess = command; // Store command object instead of ffmpegProc
                })
                .on('error', async function(error, stdout, stderr) {
                    clearTimeout(killTimeout);
                    console.error('FFmpeg error:', error.message);
                    console.error('FFmpeg stderr:', stderr);

                    if (!isCompleted) {
                        isCompleted = true;

                        // Check if we have some output despite the error
                        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                            console.log(`Using output file despite error (size: ${fs.statSync(outputPath).size} bytes)`);

                            // Need to convert to PassThrough for the S3 upload
                            const fileData = fs.readFileSync(outputPath);
                            const passThrough = new PassThrough();
                            passThrough.end(fileData);

                            const url = await uploadFileToS3(outputPath);
                            deleteTempFile(outputPath); // Delete temp file after upload
                            resolve(url);
                        } else {
                            deleteTempFile(outputPath); // Delete temp file even on error
                            reject(error);
                        }
                    }
                })
                .on('progress', function(progress) {
                    // Store last progress
                    command._lastProgress = progress;

                    // Only log every second to avoid flooding
                    const currentTime = Date.now();
                    if (currentTime - startTime > MAX_PROCESS_TIME * 0.8) {
                        console.log(`Process taking too long (${(currentTime - startTime)/1000}s), will force terminate soon`);
                    }

                    // Check if timemark is stuck
                    if (progress.timemark) {
                        const timemarkSeconds = convertTimemarkToSeconds(progress.timemark);
                        if (timemarkSeconds >= start + duration - 0.5) {
                            console.log('Reached target duration, finishing...');
                            command.kill('SIGKILL');
                        }
                    }
                })
                .on('end', async function() {
                    clearTimeout(killTimeout);
                    console.log(`Processing completed in ${(Date.now() - startTime) / 1000}s`);

                    if (!isCompleted) {
                        isCompleted = true;

                        // Upload the file
                        try {
                            const url = await uploadFileToS3(outputPath);
                            deleteTempFile(outputPath); // Delete temp file after upload
                            resolve(url);
                        } catch (error) {
                            deleteTempFile(outputPath); // Delete temp file even on error
                            reject(new Error('Error reading output file: ' + (error.message || 'Unknown error')));
                        }
                    }
                });

            // Run the command
            command.run();

            // Set an extra safety timeout to detect stuck processes
            let lastProgressTimemark = '';
            let stuckCounter = 0;

            const stuckDetector = setInterval(() => {
                if (isCompleted) {
                    clearInterval(stuckDetector);
                    return;
                }

                const lastProgress = command._lastProgress;

                if (lastProgress && lastProgress.timemark === lastProgressTimemark) {
                    stuckCounter++;
                    console.log(`Process appears stuck at ${lastProgressTimemark} for ${stuckCounter} checks`);

                    if (stuckCounter >= 5) { // Stuck for 5 checks (5 seconds)
                        console.log('Process confirmed stuck, force terminating');
                        clearInterval(stuckDetector);
                        forceTerminate();
                    }
                } else if (lastProgress) {
                    lastProgressTimemark = lastProgress.timemark;
                    stuckCounter = 0;
                }
            }, 1000);
        });
    } catch (error) {
        console.error('YouTube download error:', error);
        // Clean up temp file if it exists in case of early errors
        if (fs.existsSync(outputPath)) {
            deleteTempFile(outputPath);
        }
        throw error;
    }
};

module.exports = { YoutubeChunkSetter };
