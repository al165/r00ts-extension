const path = require("path");
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const ManifestMergePlugin = require('./plugins/ManifestMergePlugin');

module.exports = merge(common, {
    output: {
        path: path.resolve(__dirname, "dist", "chrome-extension"),
        filename: "[name].js",
        clean: true
    },
    plugins: [
        new ManifestMergePlugin('./manifests/manifest.chrome.json')
    ],
});
