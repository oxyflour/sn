import fs from 'fs'
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
            path.join(__dirname, '..', '..', 'src', 'wrapper', 'web')
    return {
        name: 'sn-vite',
        resolveId(id, importer) {
            if (id.startsWith('/@yff/sn/')) {
                return id
            }
            if (importer?.startsWith('/@yff/sn/') && id.startsWith('.')) {
                return path.join(path.dirname(importer), id + '.tsx').replace('\\', '/')
            }
            return
        },
        load(id) {
            if (id.replace(/\\/g, '/').startsWith('/@yff/sn/')) {
                const file = id.slice('/@yff/sn/'.length)
                return fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8')
            }
            return
        },
        transform(code, id) {
            const module = Object.entries(modules || { })
                .find(([, { lambda }]) => isInside(id, lambda))
            if (id === '/@yff/sn/src/bootstrap.tsx') {
                const imports = [] as string[]
                const entries = Object.entries(modules).map(([key, { lambda }], idx) => {
                    imports.push(`import * as sn_src_pages_${idx} from '/src/pages';`)
                    return `{` +
                            `const context = import.meta.glob('/src/pages/**/*.tsx'),` +
                                `loading = sn_src_pages_${idx}.loading,` +
                                `layout = sn_src_pages_${idx}.layout,` +
                                `lambda = ${JSON.stringify(lambda)};` +
                            `ctx[${JSON.stringify('/' + key)}] = { context, loading, layout, lambda };` +
                        `}`
                    }).join(';')
                return imports.join(';') + `{ const ctx = window.SN_PAGE_CONTEXT = { }; ${entries} };` + code
            } else if (module) {
                const prefix = module[0]
                return `
                import wrapper from ${JSON.stringify(getImportPath(wrapperPath, path.dirname(id)))}
                export default wrapper(${JSON.stringify({ prefix })})
                `
            } else {
                return code
            }
        },
    } as vite.PluginOption
}
