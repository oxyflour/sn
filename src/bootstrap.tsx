import React from 'react'
import ReactDOM from 'react-dom'

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

const App = require(process.env.CWD + '/pages').default
ReactDOM.render(<App />, root)

const mod = module as any
if (mod.hot) {
    mod.hot.accept()
}
