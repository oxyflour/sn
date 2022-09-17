import 'vite/modulepreload-polyfill'

import React, { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter as Router, Route, Routes, useMatch, useNavigate } from 'react-router-dom'

import VueWrapper from './wrapper/vue'

let div = document.getElementById('root') as any
if (!div) {
    div = document.createElement('div')
    div.id = 'root'
    document.body.appendChild(div)
}

function lazy(context: any, opts: any) {
    let error: any,
        result: any,
        pending: Promise<any> | null
    function Lazy(props: { path: string }) {
        const navigate = useNavigate(),
            match = useMatch(props.path)
        if (pending) {
            throw pending
        } else if (error) {
            throw error
        } else if (result) {
            return opts.tsx || opts.js ?
                <result.default { ...match }></result.default> :
            opts.vue ?
                <VueWrapper route={ match } navigate={ navigate } component={ result.default } /> :
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

const root = div.__root || (div.__root = createRoot(div))
root.render(<Router>
<Routes>
    { routes.map(({ file, path, ...rest }) =>
        <Route key={ file } path={ path } element={ <rest.comp path={ path } /> } />) }
    <Route path="*">404</Route>
</Routes>
</Router>)
