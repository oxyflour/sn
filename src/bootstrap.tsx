import 'vite/modulepreload-polyfill'

import React, { Suspense } from 'react'
import ReactDOM from 'react-dom'
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom'
import { useHistory } from 'react-router'

import VueWrapper from './wrapper/vue'

let root = document.getElementById('root')
if (!root) {
    root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    if ((window as any).__SN_DEV__) {
        new EventSource('/sse/watch').addEventListener('message', evt => {
            const data = JSON.parse(evt.data)
            if (data.reload) {
                location.reload()
            }
        })
    }
}

function lazy(context: any, opts: any) {
    let error: any,
        result: any,
        pending: Promise<any> | null
    function Lazy(props: any) {
        const history = useHistory()
        if (pending) {
            throw pending
        } else if (error) {
            throw error
        } else if (result) {
            return opts.tsx || opts.js ?
                <result.default { ...props  }></result.default> :
            opts.vue ?
                <VueWrapper route={ props } history={ history } component={ result.default } /> :
                <div>unknown component fetched: {JSON.stringify(result)}</div>
        } else {
            (pending = context() as Promise<any>).then(
                ret => { pending = null; result = ret },
                err => { pending = null; error = err })
            throw pending
        }
    }
    return (props: any) => {
        return <Suspense fallback={ opts.loading || '...' }>
            <Lazy { ...props } />
        </Suspense>
    }
}

const routes = [] as { file: string, path: string, comp: any }[]
for (const [prefix, { context }] of Object.entries(((window as any).SN_PAGE_CONTEXT || { }) as { [prefix: string]: any })) {
    const items = Object.entries(context)
            .map(([file, load]) => ({
                file: prefix + file
                    .replace(/^\//, ''),
                path: prefix + file
                    .replace(/^\//, '')
                    .replace(/\/index\.(tsx|jsx|vue)$/, '')
                    .replace(/\.(tsx|jsx|vue)$/, '')
                    .split('/').slice(2).join('/')
                    .replace(/\[([^\]]+)]/g, ':$1'),
                comp: lazy(load, {
                    tsx: file.endsWith('.tsx'),
                    vue: file.endsWith('.vue'),
                    js:  file.endsWith('.js'),
                }),
            })).sort().reverse()
    routes.push(...items)
}

ReactDOM.render(<Router>
<Switch>
    { routes.map(({ file, path, comp }) => <Route exact key={ file } path={ path } component={ comp } />) }
    <Route path="*">404</Route>
</Switch>
</Router>, root)
