import { getOptions } from 'loader-utils'
import isInside from 'is-path-inside'
import path from 'path'

export default function LambdaEntryLoader(this: any, source: string) {
    const { apiPath, options = { } } = getOptions(this)
    if (isInside(this.resourcePath, apiPath + '')) {
        return `
        import wrapper from '${path.join(__dirname, '..', 'wrapper', 'web')}'
        export default wrapper(${JSON.stringify(options)})
        `
    } else {
        return source
    }
}
