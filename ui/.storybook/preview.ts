import type { Preview } from '@storybook/nextjs-vite'
import '../src/app/globals.css'
import { initialize, mswLoader } from 'msw-storybook-addon'
import { handlers } from './msw-handlers'

// Initialize MSW
initialize({
  onUnhandledRequest: 'bypass',
})

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo'
    },
    msw: {
      handlers,
    },
  },
  decorators: [
    (Story) => {
      document.documentElement.classList.add('dark');
      return Story();
    },
  ],
  loaders: [mswLoader],
};

export default preview;
