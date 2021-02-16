const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
    entry:'./pages/index.tsx',
    devtool: 'inline-source-map',
    output: {
        publicPath: '/',
        filename: 'bundle.js'
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            }
        ]
    },
    resolve: {
        extensions: [ '.tsx', '.ts', '.js' ],
    },
    plugins: [
        new HtmlWebpackPlugin()
    ]
}
