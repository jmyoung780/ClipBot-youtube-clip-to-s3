const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { generateUploadURL } = require('./src/utils/S3');
const { YoutubeChunkSetter } = require('./src/utils/youtubeChunkSetter/YoutubeChunkSetter');

async function startServer() {
    const app = express();
    const server = http.createServer(app);

    app.use(cookieParser());
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    }));

    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    app.get('/', (req, res, next) => {
        res.send('server ok');
    });

    app.get('/s3url', async (req, res, next) => {
        const url = await generateUploadURL();
        res.send({ url });
    });

    app.get('/youtubechunk-to-s3', async(req, res, next) => {
        try {
            const youtubeUrl = req.query.url;
            const startSecond = req.query.start;
            const endSecond = req.query.end;

            const s3url = await YoutubeChunkSetter(youtubeUrl, Number(startSecond).toFixed(0), Number(endSecond).toFixed(0));
            res.status(200).json({
                fileurl: s3url,
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('An error occurred');
        }
    });

    server.listen(5001, () => {
        console.log(`Listening to port ${5001}...`);
    });
}

startServer();
