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

function lazy(fetch: () => any, loading: JSX.Element, error: JSX.Element, opts: { [key: string]: boolean }) {
    return function Lazy(props: any) {
        const [elem, setElem] = useState(loading),
            history = useHistory()
        async function init() {
            try {
                const comp = await fetch()
                opts.tsx || opts.js ?
                    setElem(React.createElement(comp.default, props)) :
                opts.vue ?
                    setElem(<VueWrapper route={ props } history={ history } component={ comp.default } />) :
                    setElem(<div>unknown component fetched: {JSON.stringify(comp)}</div>)
            } catch (err) {
                console.log(err)
                setElem(error)
            }
        }
        useEffect(() => { init() }, [])
        return elem
    }
}

const routes = [] as { file: string, path: string, comp: any }[]
for (const [prefix, { context }] of Object.entries(((window as any).SN_PAGE_CONTEXT || { }) as { [prefix: string]: any })) {
    const files = context.keys() as string[],
        items = files
        .filter(file => {
            return !file.endsWith('.tsx') && !file.endsWith('.vue') && !(file.length > 2 && file.endsWith('/'))
        })
        .map(file => ({
            file,
            tsx: files.includes(file + '.tsx') || files.includes(file + 'index.tsx'),
            vue: files.includes(file + '.vue') || files.includes(file + 'index.vue'),
            js: files.includes(file + '.js') || files.includes(file + 'index.js'),
        }))
        .map(({ file, tsx, vue, js }) => ({
            file: prefix + file.slice(2),
            comp: lazy(() => context(file), <div>...</div>, <div>500</div>, { tsx, vue, js }),
            path: prefix + file.slice(2).replace(/\[([^\]]+)]/, ':$1'),
        })).sort((a, b) => {
            return b.path.split('/').length - a.path.split('/').length
        })
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
