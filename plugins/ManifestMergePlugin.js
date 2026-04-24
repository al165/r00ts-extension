const fs = require('fs');
const path = require('path');

class ManifestMergePlugin {
    constructor(browserManifestPath) {
        this.browserManifestPath = browserManifestPath;
    }

    apply(compiler) {
        compiler.hooks.emit.tapAsync('ManifestMergePlugin', (compilation, callback) => {
            const common = JSON.parse(
                fs.readFileSync(path.resolve(__dirname, '../manifests/manifest.common.json'), 'utf-8')
            );
            const browser = JSON.parse(
                fs.readFileSync(path.resolve(this.browserManifestPath), 'utf-8')
            );

            const merged = JSON.stringify({ ...common, ...browser }, null, 2);
            compilation.assets['manifest.json'] = {
                source: () => merged,
                size: () => merged.length,
            };

            callback();
        });
    }
}

module.exports = ManifestMergePlugin;
