import { fs } from 'mz'
import path from 'path'
import webpack from 'webpack'
import { VueLoaderPlugin } from 'vue-loader'

const root = path.join(__dirname, '..', '..')

function updateEntry(entry: webpack.Configuration['entry'], mode = 'development') {
    const urls = [
        path.join(__dirname, '..', 'bootstrap'),
    ]
    if (mode === 'development') {
        const client = require.resolve('webpack-hot-middleware/client', { paths: [root] })
        urls.push(client + '?path=/__webpack_hmr&reload=true',)
    }
    if (!entry) {
        return urls
    } else if (Array.isArray(entry)) {
        return entry.concat(urls)
    } else if (typeof entry === 'string') {
        return [entry].concat(urls)
    } else if (typeof entry === 'object') {
        const ret = { ...entry } as any
        for (const [key, value] of Object.entries(entry)) {
            if (Array.isArray(value)) {
                ret[key] = value.concat(urls)
            } else if (typeof value === 'string') {
                ret[key] = [value].concat(urls)
            } else {
                console.warn(`ignoring entry ${ret[key]}`)
            }
        }
        return ret
    } else {
        throw Error(`only entry with type object supported, got ${typeof entry}`)
    }
}

export function getWebpackConfig(configPath: string, pagesPath: string, apiPath: string,
        mode = 'development' as webpack.Configuration['mode'],
        { baseUrl, tsconfig } = { } as { baseUrl?: string, tsconfig?: any }) {
    const config = (fs.existsSync(configPath) ? require(configPath) : { }) as webpack.Configuration
    config.mode = mode
    config.entry = updateEntry(config.entry, mode)
    config.plugins = (config.plugins || []).concat([
        new webpack.EnvironmentPlugin({ PAGES_PATH: pagesPath }),
        new webpack.HotModuleReplacementPlugin(),
        new VueLoaderPlugin() as any,
    ])
    if (!config.module) {
        config.module = { }
    }
    if (!config.module.rules) {
        config.module.rules = [
            {
                test: /\.(js|mjs|jsx|ts|tsx)$/,
                use: {
                    loader: require.resolve('./loader'),
                    options: { apiPath, baseUrl },
                }
            },
            {
                test: /\.tsx?$/,
                use: {
                    loader: require.resolve('ts-loader', { paths: [root] }),
                    options: { compilerOptions: tsconfig }
                },
                exclude: /node_modules/,
            },
            {
                test: /\.vue$/,
                use: require.resolve('vue-loader', { paths: [root] }),
            },
            {
                test: /\.css$/,
                use: [
                    require.resolve('vue-style-loader', { paths: [root] }),
                    require.resolve('css-loader', { paths: [root] })
                ]
            }
        ]
    }
    if (!config.resolve) {
        config.resolve =  {
            extensions: [ '.tsx', '.ts', '.js', '.vue' ],
        }
    }
    if (!config.output) {
        config.output = {
            publicPath: '/',
            filename: 'bundle.js',
        }
    }
    if (!config.output.publicPath) {
        throw Error(`webpack config.output.publicPath is required`)
    }

    if (mode === 'development') {
        config.devtool = 'inline-source-map'
    } else {
        // TODO
    }

    return config
}
