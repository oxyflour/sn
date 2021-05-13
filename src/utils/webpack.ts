import path from 'path'
import webpack from 'webpack'
import { VueLoaderPlugin } from 'vue-loader'
import WebpackInjectPlugin, { ENTRY_ORDER } from 'webpack-inject-plugin'

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

function injectIncludes(modules: { [key: string]: { pages: string, lambda: string } }) {
    return `
    const inc = window.SN_PAGE_CONTEXT = { }
    ` + Object.entries(modules).map(([key, { pages, lambda }]) => {
    return `
    {
        const context = require.context(${JSON.stringify(pages)}),
            lambda = ${JSON.stringify(path.join(lambda))}
        inc[${JSON.stringify('/' + key)}] = { context, lambda }
        if (module.hot) {
            module.hot.accept(context.id, () => {
                const detail = require.context(${JSON.stringify(pages)})
                document.dispatchEvent(new CustomEvent('hot' + context.id, { detail }))
            })
        }
    }
    `}).join('\n')
}

export function getWebpackConfig(
    modules: { [prefi: string]: { pages: string, lambda: string } },
    tsconfig: any,
    mode?: webpack.Configuration['mode'],
    webpackConfig?: string,
    wrapperPath?: string) {
    const config = (webpackConfig ? require(webpackConfig) : { }) as webpack.Configuration,
        wrapper = wrapperPath && require.resolve(wrapperPath, { paths: [process.cwd()] })
    config.mode = mode
    config.entry = updateEntry(config.entry, mode)
    config.plugins = (config.plugins || []).concat([
        new webpack.HotModuleReplacementPlugin(),
        new webpack.ContextExclusionPlugin(/\.map$/),
        new webpack.ContextExclusionPlugin(/\.d\.ts$/),
        new VueLoaderPlugin() as any,
        new WebpackInjectPlugin(() => injectIncludes(modules), {
            entryOrder: ENTRY_ORDER.First
        })
    ])
    if (!config.module) {
        config.module = { }
    }
    config.module.rules = (config.module.rules || []).concat([
        {
            test: /\.(js|mjs|jsx|ts|tsx)$/,
            use: {
                loader: require.resolve('./loader'),
                options: { modules, wrapper },
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
    ])
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
