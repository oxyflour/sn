import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom'

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

function lazy(fetch: () => any, loading: JSX.Element, error: JSX.Element) {
    return function Lazy(props: any) {
        const [elem, setElem] = useState(loading)
        async function init() {
            try {
                const comp = await fetch()
                setElem(React.createElement(comp.default, props))
            } catch (err) {
                setElem(error)
            }
        }
        useEffect(() => { init() }, [])
        return elem
    }
}

const context = (require as any).context(process.env.PAGES_PATH || '.', true),
    files = context.keys() as string[],
    routes = files.filter(file => !file.endsWith('.tsx') && !(file.length > 2 && file.endsWith('/')))
        .map(file => ({
            file,
            comp: lazy(() => context(file), <div>...</div>, <div>500</div>),
            path: file.slice(1).replace(/\[([^\]]+)]/, ':$1'),
        })).sort((a, b) => {
            return b.path.split('/').length - a.path.split('/').length
        })

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
