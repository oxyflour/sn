import fs from 'fs'
import path from 'path'
import vite from 'vite'
import isInside from 'is-path-inside'

function getImportPath(dir: string, cwd: string) {
    const ret = path.relative(cwd, dir).replace(/\\/g, '/')
    return ret.startsWith('.') ? ret : './' + ret
}

export default function vitePlugin(
        { wrapper }: { wrapper?: string },
        modules: Record<string, { pages: string, lambda: string, module: any }>) {
    const wrapperPath = wrapper && require.resolve(wrapper, { paths: [process.cwd()] }) ||
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
                const file = id.slice('/@yff/sn/'.length),
                    code = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8')
                return { code, map: null }
            }
            return
        },
        transform(code, id) {
            const module = Object.entries(modules || { })
                .find(([, { lambda }]) => isInside(id, lambda))
            if (id === '/@yff/sn/src/bootstrap.tsx') {
                const imports = [] as string[], entries = [] as string[]
                for (const [key, { lambda }] of Object.entries(modules)) {
                    const id = Math.random().toString(16).slice(2, 10)
                    imports.push(`import * as sn_src_pages_${id} from '/src/pages';`)
                    entries.push(`{
                        const context = import.meta.glob('/src/pages/**/*.tsx'),
                            pages = sn_src_pages_${id},
                            lambda = ${JSON.stringify(lambda)};
                        ctx[${JSON.stringify('/' + key)}] = { context, pages, lambda };
                    }`)
                }
                code = imports.join(';') + `{
                    const ctx = window.SN_PAGE_CONTEXT = { };
                    ${entries.join(';')}
                }; ${code}`
                code = code.replace(/\n/g, '')
            } else if (module) {
                const prefix = module[0]
                code = `
                    import wrapper from ${JSON.stringify(getImportPath(wrapperPath, path.dirname(id)))}
                    export default wrapper(${JSON.stringify({ prefix })})`
            }
            return { code, map: null }
        },
    } as vite.PluginOption
}
