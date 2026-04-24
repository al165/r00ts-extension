const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = (env) => {
    const browserConfig = require(`./webpack.${env.browser}.js`);
    return merge(common, browserConfig, {
        mode: "development",
        devtool: "cheap-module-source-map"
    });
}
