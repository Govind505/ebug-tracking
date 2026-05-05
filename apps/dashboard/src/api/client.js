/**
 * eBug API Client
 * 
 * Connects the dashboard to the API Gateway.
 * Falls back to mock data when the API is not available.
 * Automatically includes JWT auth tokens in all requests.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8090'
const DEV_TOKEN = 'dev-token'

class EbugApiClient {
  constructor(baseUrl = API_BASE) {
    this.baseUrl = baseUrl
    this.isAvailable = null // null = unknown, true/false = tested
    this.authToken = localStorage.getItem('ebug_auth_token') || DEV_TOKEN
  }

  /**
   * Set the auth token for API requests.
   * Persists to localStorage for session continuity.
   */
  setAuthToken(token) {
    this.authToken = token
    if (token && token !== DEV_TOKEN) {
      localStorage.setItem('ebug_auth_token', token)
    }
  }

  /**
   * Clear auth token and revert to dev-token.
   */
  clearAuthToken() {
    this.authToken = DEV_TOKEN
    localStorage.removeItem('ebug_auth_token')
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
          ...options.headers,
        },
        ...options,
      })

      // Handle auth errors — clear stale token
      if (response.status === 401) {
        console.warn('Auth token rejected — falling back to dev-token')
        this.authToken = DEV_TOKEN
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      this.isAvailable = true
      return await response.json()
    } catch (err) {
      this.isAvailable = false
      console.warn(`API unavailable (${path}):`, err.message)
      return null
    }
  }

  // ── Bug Operations ──

  async listBugs(params = {}) {
    const query = new URLSearchParams()
    if (params.status) query.set('status', params.status)
    if (params.severity) query.set('severity', params.severity)
    if (params.category) query.set('category', params.category)
    if (params.search) query.set('search', params.search)
    if (params.page) query.set('page', params.page)
    if (params.limit) query.set('limit', params.limit)
    if (params.sort) query.set('sort', params.sort)
    if (params.order) query.set('order', params.order)

    return this.request(`/api/v1/bugs?${query.toString()}`)
  }

  async getBug(id) {
    return this.request(`/api/v1/bugs/${id}`)
  }

  async createBug(data) {
    return this.request('/api/v1/bugs', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateBug(id, data) {
    return this.request(`/api/v1/bugs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async transitionBug(id, newStatus, comment = '') {
    return this.request(`/api/v1/bugs/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ new_status: newStatus, comment }),
    })
  }

  async getBugActivity(id) {
    return this.request(`/api/v1/bugs/${id}/activity`)
  }

  // ── Stats ──

  async getStats() {
    return this.request('/api/v1/stats')
  }

  async getTimeline(days = 30) {
    return this.request(`/api/v1/stats/timeline?days=${days}`)
  }

  // ── Teams ──

  async getTeams() {
    return this.request('/api/v1/teams')
  }

  // ── Users ──

  async getUsers() {
    return this.request('/api/v1/users')
  }

  // ── Health ──

  async checkHealth() {
    const result = await this.request('/health')
    this.isAvailable = result !== null
    return this.isAvailable
  }
}

// Singleton instance
export const api = new EbugApiClient()
export default api
