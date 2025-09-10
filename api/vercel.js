const axios = require('axios');
const unzipper = require('unzipper');

export default async function handler(req, res) {
    const { version } = req.query;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (!version) {
        return res.status(400).send('Version query parameter is required.');
    }

    const zipUrl = `https://github.com/radareorg/radare2/releases/download/${version}/radare2-${version}-wasi.zip`;

    try {
        console.log(`Fetching and extracting WASM for version ${version}...`);

        const response = await axios.get(zipUrl, {
            responseType: 'stream'
        });

        res.setHeader('Content-Type', 'application/wasm');
        
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
}