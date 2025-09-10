const express = require('express');
const axios = require('axios');
const cors = require('cors');
const unzipper = require('unzipper');

const app = express();

app.use(cors());


app.get('/wasm', async (req, res) => {
    const version = req.query.version;
    if (!version) {
        return res.status(400).send('Version query parameter is required.');
    }
    const zipUrl = `https://github.com/radareorg/radare2/releases/download/${version}/radare2-${version}-wasi.zip`;

    try {
        console.log(`Fetching and extracting WASM for version ${version}...`);
        const response = await axios.get(zipUrl, {
            responseType: 'stream'
        });

        res.set({
            'Content-Type': 'application/wasm',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*'
        });

        response.data
            .pipe(unzipper.ParseOne(/radare2\.wasm$/))
            .pipe(res)
            .on('error', (err) => {
                console.error('Error extracting WASM:', err);
                if (!res.headersSent) {
                    res.status(500).send('Error extracting WASM file');
                }
            });
    } catch (error) {
        console.error('Error fetching ZIP file:', error.message);
        if (!res.headersSent) {
            res.status(500).send('Error fetching ZIP file');
        }
    }
});

module.exports = app;