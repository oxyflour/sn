import { getOptions } from 'loader-utils'
import isInside from 'is-path-inside'
import path from 'path'

export default function LambdaEntryLoader(this: { resourcePath: string }, source: string) {
    const { modules, wrapper } = getOptions(this),
        module = Object.entries(modules || { }).find(([, { lambda }]) => isInside(this.resourcePath, lambda))
    if (module) {
        return `
        import wrapper from ${JSON.stringify(wrapper || path.join(__dirname, '..', 'wrapper', 'web'))}
        export default wrapper(${JSON.stringify({ prefix: module[0] })})
        `
    } else {
        return source
    }
}
