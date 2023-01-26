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

function lazy(context: () => Promise<any>, opts: {
    file: string
    loading?: Function
    layout?: Function
}) {
    let error: any,
        result: any,
        pending: Promise<any> | null
    const name = opts.file.toLowerCase(),
        isReact = !!name.match(/\.[jt]sx?$/),
        isVue = name.endsWith('.vue')
    function Lazy(props: { path: string }) {
        const navigate = useNavigate(),
            match = useMatch(props.path)
        function render() {
            return isReact ? <result.default { ...match }></result.default> :
                isVue ? <VueWrapper route={ match } navigate={ navigate } component={ result.default } /> :
                <div>unknown component fetched: {JSON.stringify(result)}</div>
        }
        if (pending) {
            throw pending
        } else if (error) {
            throw error
        } else if (result) {
            return opts.layout ? <opts.layout>{ render() }</opts.layout> : render()
        } else {
            (pending = context()).then(
                ret => { pending = null; result = ret },
                err => { pending = null; error = err })
            throw pending
        }
    }
    return (props: any) => {
        return <Suspense fallback={ opts.loading ? <opts.loading /> : '...' }>
            <Lazy { ...props } />
        </Suspense>
    }
}

const routes = [] as { file: string, path: string, comp: any }[],
    contexes = ((window as any).SN_PAGE_CONTEXT || { }) as Record<string, {
        context: Record<string, () => Promise<any>>
        pages: { loading?: Function, layout?: Function }
    }>
for (const [prefix, { context, pages }] of Object.entries(contexes)) {
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
                comp: lazy(load, { ...pages, file }),
            })).sort().reverse()
    routes.push(...items)
}

const root = div.__root || (div.__root = createRoot(div))
root.render(<Router>
<Routes>
    {
        routes.map(({ file, path, ...rest }) =>
        <Route key={ file } path={ path } element={ <rest.comp path={ path } /> } />)
    }
    <Route path="*">404</Route>
</Routes>
</Router>)
