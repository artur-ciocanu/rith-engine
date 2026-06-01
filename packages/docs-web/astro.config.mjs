import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://github.com/artur-ciocanu/rith-engine',
  integrations: [
    starlight({
      title: 'Rith Engine',
      favicon: '/favicon.png',
      logo: {
        src: './src/assets/logo.png',
        alt: 'Rith Engine',
      },
      description: 'AI workflow engine — package your coding workflows as YAML, run them anywhere.',
      head: [
        {
          tag: 'script',
          content: `if(!localStorage.getItem('rith-theme-init')){localStorage.setItem('rith-theme-init','1');localStorage.setItem('starlight-theme','dark');document.documentElement.dataset.theme='dark';}`,
        },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/artur-ciocanu/rith-engine' }],
      editLink: {
        baseUrl: 'https://github.com/artur-ciocanu/rith-engine/edit/main/packages/docs-web/',
      },
      sidebar: [
        { label: '✦  Marketplace', link: '/workflows/' },
        { label: '🗺️  Roadmap', link: '/roadmap/' },
        { label: '🎨  Brand', link: '/brand/' },
        {
          label: 'The Book of Rith Engine',
          autogenerate: { directory: 'book' },
        },
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'Adapters',
          autogenerate: { directory: 'adapters' },
        },
        {
          label: 'Deployment',
          autogenerate: { directory: 'deployment' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
        {
          label: 'Contributing',
          autogenerate: { directory: 'contributing' },
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
