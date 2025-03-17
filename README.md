# YouTube Chunk to S3

A lightweight, reliable server for extracting and processing specific segments from YouTube videos and automatically uploading them to AWS S3.

## 🚀 Features

- **Extract Video Segments**: Clip any portion of YouTube videos by specifying start and end times
- **Reliable Processing**: Built-in safeguards for handling network issues and preventing stuck processes
- **Cloud Storage Integration**: Automatic upload to AWS S3 with pre-signed URLs
- **RESTful API**: Simple HTTP endpoints for easy integration with any application
- **Optimized for Automation**: Perfect for content repurposing workflows

## 📋 API Endpoints

### GET `/youtubechunk-to-s3`

Extract a segment from a YouTube video and upload it to S3.

**Query Parameters**:
- `url`: The YouTube video URL
- `start`: Start time in seconds
- `end`: End time in seconds

**Response**:
```json
{
  "fileurl": "https://your-bucket.s3.region.amazonaws.com/filename.mp4"
}
```
## 🛠️ Setup

1. Clone this repository
2. Install dependencies:
```json
npm install
```
Copy

4. Create a `.env` file with your AWS credentials:
```json
S3_BUCKET=your-bucket-name
AWS_REGION=your-aws-region
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```
Copy4. Start the server:
```json
npm start
```
Copy
## 🔧 Technical Details

The service uses:
- `@distube/ytdl-core` for reliable YouTube video extraction
- `fluent-ffmpeg` for precise video segment processing
- AWS S3 for secure cloud storage
- Express.js for the API server

## 🧰 Use Cases

- Content repurposing automation
- Creating highlights from longer videos
- Integration with n8n or other workflow automation tools
- Social media content generation
