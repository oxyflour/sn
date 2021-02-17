import { hookFunc } from '../utils/common'

export default <T extends { }>({ url = '/rpc' }: {
    url?: string
}) => hookFunc({ } as T, (...stack) => {
    const entry = stack.map(item => item.propKey),
        part = entry.slice().reverse().join('/')
    return async (...args: any[]) => {
        const body = JSON.stringify({ entry, args }),
            method = 'POST',
            headers = { Accept: 'application/json', 'Content-Type': 'application/json' },
            req = await fetch(`${url}/${part}`, { headers, body, method }),
            { err, ret } = await req.json()
        if (err) {
            throw Error()
        } else {
            return ret
        }
    }
})
