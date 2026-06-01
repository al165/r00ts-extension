const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const Dotenv = require('dotenv-webpack');

module.exports = {
    entry: {
        background: "./src/background.ts",
        "popup/script": "./src/popup/script.ts"
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "[name].js",
        clean: true
    },
    module: {
        rules: [{
            test: /\.(ts|tsx)$/,
            use: { loader: 'ts-loader', options: { transpileOnly: true } },

            exclude: /node_modules/,
        },
        { test: /\.css?$/, use: ["style-loader", "css-loader"] },
        ]
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: "src", to: ".", globOptions: { ignore: ["**/*.js", "**/*.ts"] } }
            ]
        }),
        new Dotenv()
    ]
};
