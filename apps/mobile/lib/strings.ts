// Every user-facing string of the app, in Brazilian Portuguese. Screens read
// text from here only, so a second language is a copy of this object.
export const strings = {
  root: {
    title: 'Barber',
    tagline: 'Prévias de corte na cadeira, em segundos.',
    loadFailed: 'Não foi possível abrir sua conta. Verifique sua conexão.',
    retry: 'Tentar de novo',
  },
  login: {
    email: 'E-mail',
    password: 'Senha',
    submit: 'Entrar',
    forgotPassword: 'Esqueci minha senha',
    wrongCredentials: 'E-mail ou senha incorretos.',
    notABarber: 'Esta conta não pertence a nenhuma barbearia.',
    failed: 'Não foi possível entrar. Verifique sua conexão e tente de novo.',
  },
  forgotPassword: {
    title: 'Redefinir senha',
    message: 'Informe seu e-mail e enviaremos um link para criar uma nova senha.',
    email: 'E-mail',
    submit: 'Enviar link',
    sent: 'Se este e-mail tiver uma conta, o link chega em instantes. Abra-o neste celular.',
    failed: 'Não foi possível enviar o link. Verifique sua conexão e tente de novo.',
    backToLogin: 'Voltar para o login',
  },
  resetPassword: {
    title: 'Nova senha',
    opening: 'Abrindo o link…',
    password: 'Nova senha',
    confirm: 'Repita a nova senha',
    submit: 'Salvar senha',
    tooShort: 'A senha precisa de pelo menos 6 caracteres.',
    mismatch: 'As senhas não são iguais.',
    weak: 'Esta senha é fraca demais. Escolha outra.',
    same: 'A nova senha precisa ser diferente da atual.',
    failed: 'Não foi possível salvar a senha. Verifique sua conexão e tente de novo.',
    linkExpired: 'Este link expirou ou já foi usado. Peça um novo.',
    requestAgain: 'Pedir um novo link',
  },
  home: {
    search: 'Buscar cliente',
    newClient: 'Novo cliente',
    recentVisits: 'Visitas recentes',
    noVisits: 'Nenhuma visita ainda.',
    noClients: 'Nenhum cliente encontrado.',
    loadFailed: 'Não foi possível carregar. Puxe para tentar de novo.',
    signOut: 'Sair',
  },
  visit: {
    by: (barber: string) => `com ${barber}`,
    look: 'Visual escolhido',
    after: 'Foto depois',
    open: 'Em andamento',
  },
  newClient: {
    title: 'Novo cliente',
    name: 'Nome',
    phone: 'Telefone (opcional)',
    submit: 'Cadastrar',
    nameRequired: 'Informe o nome do cliente.',
    failed: 'Não foi possível cadastrar. Verifique sua conexão e tente de novo.',
  },
  client: {
    noPhone: 'Sem telefone',
    visits: 'Visitas',
    noVisits: 'Nenhuma visita ainda.',
    newVisit: 'Nova visita',
    loadFailed: 'Não foi possível carregar o cliente.',
    retry: 'Tentar de novo',
  },
  newVisit: {
    title: 'Nova visita',
    comingSoon: 'Em breve.',
  },
  notFound: {
    title: 'Ops!',
    message: 'Esta tela não existe.',
    goHome: 'Voltar para o início',
  },
} as const;

// Dates as the barber reads them, in the device's time zone.
export function formatVisitDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
