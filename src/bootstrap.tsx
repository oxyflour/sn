import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom'

let root = document.getElementById('root')
if (!root) {
    root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    new EventSource('/sse').addEventListener('message', evt => {
        const data = JSON.parse(evt.data)
        if (data.reload) {
            location.reload()
        }
    })
}

function lazy(fetch: () => any, fallback: JSX.Element) {
    return function Lazy(props: any) {
        const [elem, setElem] = useState(fallback)
        async function init() {
            const comp = await fetch()
            setElem(React.createElement(comp.default, props))
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
            comp: lazy(() => context(file), <div>...</div>),
            path: file.slice(1).replace(/\.tsx?$/i, '').replace(/\[([^\]]+)]/, ':$1'),
        })).sort((a, b) => {
            return b.path.split('/').length - a.path.split('/').length
        })

ReactDOM.render(<Router>
<Switch>
    { routes.map(({ file, path, comp }) => <Route key={ file } path={ path } component={ comp } />) }
</Switch>
</Router>, root)

const mod = module as any
if (mod.hot) {
    mod.hot.accept()
}
