export type RuntimeConnection = 'demo' | 'checking' | 'online' | 'offline'

type Pairing = { endpoint: string; token: string }

export function useRuntimeApi() {
  const config = useRuntimeConfig()
  const endpoint = useState('capri-runtime-endpoint', () => String(config.public.runtimeEndpoint || '').replace(/\/$/, ''))
  const token = useState('capri-runtime-token', () => String(config.public.runtimeToken || ''))
  const status = useState<RuntimeConnection>('capri-runtime-status', () => endpoint.value ? 'checking' : 'demo')
  const lastChecked = useState('capri-runtime-last-checked', () => '')

  function loadPairing() {
    if (!import.meta.client) return
    try {
      const saved = JSON.parse(localStorage.getItem('capri.pairing.v1') || 'null') as Pairing | null
      if (saved?.endpoint) endpoint.value = saved.endpoint.replace(/\/$/, '')
      if (saved?.token) token.value = saved.token
    } catch {}
  }

  async function check() {
    if (!endpoint.value) {
      status.value = 'demo'
      return false
    }
    status.value = 'checking'
    try {
      const response = await fetch(`${endpoint.value}/api/v1/health`, { headers: token.value ? { Authorization: `Bearer ${token.value}` } : {}, cache: 'no-store' })
      if (!response.ok) throw new Error(`Runtime returned ${response.status}`)
      status.value = 'online'
      lastChecked.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return true
    } catch {
      status.value = 'offline'
      lastChecked.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return false
    }
  }

  function savePairing(nextEndpoint: string, nextToken: string) {
    endpoint.value = nextEndpoint.trim().replace(/\/$/, '')
    token.value = nextToken.trim()
    if (import.meta.client) localStorage.setItem('capri.pairing.v1', JSON.stringify({ endpoint: endpoint.value, token: token.value }))
  }

  return { endpoint, token, status, lastChecked, loadPairing, check, savePairing }
}
