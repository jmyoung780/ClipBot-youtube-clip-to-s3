const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const path = require('path');
const { generateUploadURL } = require('../S3');

// 🔐 Your YouTube session cookies
const headers = {
  "Cookie": "_ga=GA1.1.205701582.1718050074; _ga_HTXKR35SN9=GS1.1.1718050075.1.1.1718050140.0.0.0; ajs_anonymous_id=%22c0c2d0ce-4cbc-4c5a-a645-fa0f48fb1286%22; APISID=3v0uKn3SHIItkRHC/A-mMM91L1Fr0WriWH; SAPISID=s3cHPQz3jbk-VQ8f/AvaqjCIEZZdJ6Egko; __Secure-1PAPISID=s3cHPQz3jbk-VQ8f/AvaqjCIEZZdJ6Egko; __Secure-3PAPISID=s3cHPQz3jbk-VQ8f/AvaqjCIEZZdJ6Egko; SID=g.a000xAjqJ9qm4PpAN-6xNshJvdg5nT6mhTqK9No3AlnFNm4eGBM8tRTlfPgkIvdxn0TCXlZK5AACgYKAcMSARMSFQHGX2MirxYVkW2_I4rlUkIHJZwflhoVAUF8yKrhQXnBnAu1kIfnJy2KBciN0076; PREF=f6=81&f7=4100&tz=America.Guatemala; SIDCC=AKEyXzX_XmS7azswk7Ywp0YLs1y8xI5yJXN477hDkE81yFIWf_Z3ApMoyGZqxltnjyoLYrvlXag",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
};

function secondsToTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}.000`;
}

function convertTimemarkToSeconds(t) {
  const [h, m, s] = t.split(':');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}

async function uploadFileToS3(outputPath) {
  const fileData = fs.readFileSync(outputPath);
  const uploadUrl = await generateUploadURL();

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: fileData,
    headers: { 'Content-Type': 'video/mp4' },
    duplex: 'half'
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 upload failed with status ${response.status}: ${errorText}`);
  }

  return uploadUrl.split('?')[0];
}

function deleteTempFile(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function ensureTempDirExists(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createFfmpegCommand(stream, outPath, start, duration) {
  return ffmpeg(stream)
    .inputFormat('mp4')
    .outputOptions([
      '-ss', secondsToTime(start),
      '-t', duration.toString(),
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', 'frag_keyframe+empty_moov'
    ])
    .output(outPath);
}

const YoutubeChunkSetter = async (youtubeUrl, start, end) => {
  const id = Date.now().toString();
  const dir = path.join(process.cwd(), 'temp');
  const out = path.join(dir, `${id}.mp4`);
  ensureTempDirExists(dir);

  const duration = end - start;
  const info = await ytdl.getInfo(youtubeUrl, { requestOptions: { headers } });
  console.log(`Fetched video info for: ${info.videoDetails.title}`);

  const stream = ytdl(youtubeUrl, {
    quality: 'highest',
    filter: 'audioandvideo',
    requestOptions: { headers }
  });

  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => endEarly(), Math.max(30000, duration * 2000));

    const endEarly = async () => {
      if (!done) {
        done = true;
        if (fs.existsSync(out)) {
          const url = await uploadFileToS3(out);
          deleteTempFile(out);
          resolve(url);
        } else {
          reject(new Error('Timeout — no output generated'));
        }
      }
    };

    const cmd = createFfmpegCommand(stream, out, start, duration);

    cmd.on('start', cmdline => console.log('FFmpeg start:', cmdline))
      .on('error', async (err, stdout, stderr) => {
        clearTimeout(timeout);
        console.error('FFmpeg error:', err.message);
        if (!done && fs.existsSync(out)) {
          const url = await uploadFileToS3(out);
          deleteTempFile(out);
          resolve(url);
        } else {
          reject(err);
        }
      })
      .on('progress', p => {
        if (convertTimemarkToSeconds(p.timemark || '0:0:0') >= start + duration - 0.5) {
          cmd.kill('SIGKILL');
        }
      })
      .on('end', async () => {
        clearTimeout(timeout);
        if (!done) {
          done = true;
          const url = await uploadFileToS3(out);
          deleteTempFile(out);
          resolve(url);
        }
      });

    cmd.run();
  });
};

module.exports = { YoutubeChunkSetter };
