import React, { Component } from 'react'
import Vue from 'vue'
import { ThisTypedComponentOptionsWithArrayProps } from 'vue/types/options'

Object.defineProperty(Vue.prototype, '$router', {
    get() {
        throw Error(`not implemented`)
    }
})

function makeLink(history: any) {
    return {
        props: ['to'],
        render(createElement) {
            return createElement('a', {
                on: {
                    click: (evt: MouseEvent) => {
                        evt.preventDefault()
                        history.push(this.$props.to)
                    }
                },
                attrs: {
                    href: this.$props.to,
                },
            }, this.$slots.default)
        }
    } as ThisTypedComponentOptionsWithArrayProps<Vue, any, any, any, any>
}

export default class Wrapper extends Component<{ route: any, component: any, history: any }> {
    ref = null as HTMLDivElement | null
    vue = null as Vue | null
    componentDidMount() {
        if (this.ref && !this.vue) {
            console.log(this.ref, this.vue)
            const comp = 'vue-comp-' + Math.random().toString(16).slice(2, 10),
                el = document.createElement('div'),
                { history, component, route } = this.props,
                components = Object.assign({ }, component.components, { Link: makeLink(history) })
            this.ref.appendChild(el)
            this.vue = new Vue({
                el,
                render: createElement => createElement(comp, { props: route }),
                components: { [comp]: { ...component, components } },
            })
        }
    }
    componentWillUnmount() {
        if (this.vue) {
            this.vue.$destroy()
        }
    }
    render() {
        return <div className="vue-wrapper" ref={ ref => this.ref = ref } />
    }
}
