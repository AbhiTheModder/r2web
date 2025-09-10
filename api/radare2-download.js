export default async function handler(req, res) {
    const { version } = req.query;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Get GitHub API to find asset
        const apiResponse = await fetch(
            `https://api.github.com/repos/radareorg/radare2/releases/tags/${version}`
        );
        const release = await apiResponse.json();
        const asset = release.assets.find(a => a.name === `radare2-${version}-wasi.zip`);

        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        // Fetch the actual file (server-side, no CORS issues)
        const fileResponse = await fetch(asset.browser_download_url);

        if (!fileResponse.ok) {
            return res.status(500).json({ error: 'Failed to download file' });
        }

        // Stream to client with proper headers
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);

        const buffer = await fileResponse.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: 'Server error' });
    }
}
