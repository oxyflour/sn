import { fs } from 'mz'
import path from 'path'
import webpack from 'webpack'

function updateEntry(entry: webpack.Configuration['entry'], mode = 'development') {
    const urls = [
        path.join(__dirname, '..', 'bootstrap'),
    ]
    if (mode === 'development') {
        urls.push(path.join('webpack-hot-middleware', 'client') + '?path=/__webpack_hmr&reload=true',)
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

export function getWebpackConfig(configPath: string, pagesPath: string,
        mode = 'development' as webpack.Configuration['mode']) {
    const config = (fs.existsSync(configPath) ? require(configPath) : { }) as webpack.Configuration
    config.mode = mode
    config.entry = updateEntry(config.entry, mode)
    config.plugins = (config.plugins || []).concat([
        new webpack.EnvironmentPlugin({ PAGES_PATH: pagesPath }),
        new webpack.HotModuleReplacementPlugin(),
    ])
    if (!config.module) {
        config.module = { }
    }
    if (!config.module.rules) {
        config.module.rules = [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            }
        ]
    }
    if (!config.resolve) {
        config.resolve =  {
            extensions: [ '.tsx', '.ts', '.js' ],
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
