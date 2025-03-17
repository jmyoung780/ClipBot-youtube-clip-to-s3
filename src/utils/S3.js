const { PutObjectCommand, S3 } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { promisify } = require('util');
const randomBytes = promisify(crypto.randomBytes);

dotenv.config();
const bucketName = process.env.S3_BUCKET;
const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

const s3 = new S3({
    region,
    credentials: {
        accessKeyId,
        secretAccessKey,
    },
});

async function generateUploadURL() {
    const rawBytes = await randomBytes(16);
    const imageName = rawBytes.toString('hex');

    // Use PutObjectCommand instead of GetObjectCommand for uploads
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${imageName}.mp4`,
        ContentType: 'video/mp4',
    });

    return await getSignedUrl(s3, command, { expiresIn: 3600 });
}

module.exports = { generateUploadURL };
