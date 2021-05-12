import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom'
import { useHistory } from 'react-router'

import VueWrapper from './wrapper/vue'

let root = document.getElementById('root')
if (!root) {
    root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    new EventSource('/sse/watch').addEventListener('message', evt => {
        const data = JSON.parse(evt.data)
        if (data.reload) {
            location.reload()
        }
    })
}

function lazy(fetch: () => any, opts: { [key: string]: boolean }) {
    return function Lazy(props: any) {
        const [status, setStatus] = useState({ loading: false, error: null, comp: null as any }),
            history = useHistory()
        async function init() {
            setStatus({ loading: true, error: null, comp: null })
            try {
                setStatus({ loading: false, error: null, comp: await fetch() })
            } catch (err) {
                setStatus({ loading: false, error: err, comp: null })
            }
        }
        useEffect(() => { init() }, [])
        return status.loading ?
                (opts.loading || <div>...</div>) :
            status.error ?
                (opts.error || <div>500</div>) :
            opts.tsx || opts.js ?
                <status.comp.default { ...props  }></status.comp.default> :
            opts.vue ?
                <VueWrapper route={ props } history={ history } component={ status.comp.default } /> :
                <div>unknown component fetched: {JSON.stringify(status.comp)}</div>
    }
}

const routes = [] as { file: string, path: string, comp: any }[]
for (const [prefix, { context }] of Object.entries(((window as any).SN_PAGE_CONTEXT || { }) as { [prefix: string]: any })) {
    const files = context.keys() as string[],
        items = files
        .filter(file => !(file.length > 2 && file.endsWith('/')) && !(file.split('/').pop() + '').includes('.'))
        .map(file => ({
            file,
            tsx: files.includes(file + '.tsx') || files.includes(file + 'index.tsx'),
            vue: files.includes(file + '.vue') || files.includes(file + 'index.vue'),
            js: files.includes(file + '.js') || files.includes(file + 'index.js'),
        }))
        .map(({ file, tsx, vue, js }) => ({
            file: prefix + file.slice(2),
            comp: lazy(() => context(file), { tsx, vue, js }),
            path: prefix + file.slice(2).replace(/\[([^\]]+)]/g, ':$1'),
        })).sort().reverse()
    routes.push(...items)
}

ReactDOM.render(<Router>
<Switch>
    { routes.map(({ file, path, comp }) => <Route exact key={ file } path={ path } component={ comp } />) }
    <Route path="*">404</Route>
</Switch>
</Router>, root)

const mod = module as any
if (mod.hot) {
    mod.hot.accept()
}
