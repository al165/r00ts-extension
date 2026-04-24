const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
    entry: {
        background: "./src/background.js",
        "popup/script": "./src/popup/script.js"
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "[name].js",
        clean: true
    },
    module: {
        rules: [
            { test: /\.css?$/, use: ["style-loader", "css-loader"] },
        ]
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: "src", to: ".", globOptions: { ignore: ["**/*.js"] } }
            ]
        })
    ]
};
