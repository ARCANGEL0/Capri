export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  css: ['~/assets/css/tokens.css', '~/assets/css/base.css'],
  app: {
    head: {
      title: 'Capri // Remote controller',
      meta: [
        { name: 'description', content: 'Capri remote control for coding harnesses.' },
        { name: 'theme-color', content: '#08090b' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap' },
      ],
    },
  },
  runtimeConfig: {
    public: {
      runtimeEndpoint: '',
      runtimeToken: '',
    },
  },
})
