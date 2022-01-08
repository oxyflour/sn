import path from 'path'
import vite from 'vite'
import isInside from 'is-path-inside'

function getImportPath(dir: string, cwd: string) {
    const ret = path.relative(cwd, dir).replace(/\\/g, '/')
    return ret.startsWith('.') ? ret : './' + ret
}

export default function vitePlugin(
        options: { wrapper?: string },
        modules: Record<string, { pages: string, lambda: string, mod: any }>) {
    const wrapperPath = options.wrapper &&
            require.resolve(options.wrapper, { paths: [process.cwd()] }) ||
            path.join(__dirname, '..', '..', 'src', 'wrapper', 'web'),
        bootstrapDir = path.join(__dirname, '..', '..', 'src'),
        bootstrapPathId = path.join(bootstrapDir, 'bootstrap.tsx').replace(/\\/g, '/')
    return {
        name: 'sn-vite',
        transform(code, id) {
            const module = Object.entries(modules || { })
                .find(([, { lambda }]) => isInside(id, lambda))
            if (module) {
                const prefix = module[0]
                return `
                import wrapper from ${JSON.stringify(getImportPath(wrapperPath, path.dirname(id)))}
                export default wrapper(${JSON.stringify({ prefix })})
                `
            } else if (id === bootstrapPathId) {
                const entries = Object.entries(modules).map(([key, { pages, lambda }]) => {
                    const pagePath = getImportPath(pages, bootstrapDir) + '/**/*.tsx'
                    return `{` +
                            `const context = import.meta.glob(${JSON.stringify(pagePath)}),` +
                                `lambda = ${JSON.stringify(lambda)};` +
                            `ctx[${JSON.stringify('/' + key)}] = { context, lambda };` +
                        `}`
                    }).join(';')
                return `{ const ctx = window.SN_PAGE_CONTEXT = { }; ${entries} };` + code
            } else {
                return code
            }
        },
    } as vite.PluginOption
}
