// Every user-facing string of the app, in Brazilian Portuguese. Screens read
// text from here only, so a second language is a copy of this object.
export const strings = {
  root: {
    title: 'Barber',
    tagline: 'Prévias de corte na cadeira, em segundos.',
  },
  notFound: {
    title: 'Ops!',
    message: 'Esta tela não existe.',
    goHome: 'Voltar para o início',
  },
} as const;
