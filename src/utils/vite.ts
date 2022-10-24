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
        modules: Record<string, { pages: string, lambda: string, module: any }>) {
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
                                `pages = sn_src_pages_${idx},` +
                                `lambda = ${JSON.stringify(lambda)};` +
                            `ctx[${JSON.stringify('/' + key)}] = { context, pages, lambda };` +
                        `}`
                    }).join(';')
                return {
                    code: imports.join(';') + `{ const ctx = window.SN_PAGE_CONTEXT = { }; ${entries} };` + code,
                    map: null
                }
            } else if (module) {
                const prefix = module[0]
                return {
                    code: `
                        import wrapper from ${JSON.stringify(getImportPath(wrapperPath, path.dirname(id)))}
                        export default wrapper(${JSON.stringify({ prefix })})`,
                    map: null
                }
            } else {
                return { code, map: null }
            }
        },
    } as vite.PluginOption
}
