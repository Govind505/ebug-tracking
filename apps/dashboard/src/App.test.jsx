import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

describe('App', () => {
  it('renders sidebar brand', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    expect(screen.getByText('eBug Tracking')).toBeDefined();
    expect(screen.getByText('Universal Quality Fabric')).toBeDefined();
  });

  it('renders sidebar navigation links', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Bug Reports')).toBeDefined();
    expect(screen.getByText('Analytics')).toBeDefined();
    expect(screen.getByText('AI Triage')).toBeDefined();
    expect(screen.getByText('Deduplication')).toBeDefined();
    expect(screen.getByText('Teams')).toBeDefined();
    expect(screen.getByText('Security')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders header with search', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    expect(screen.getByPlaceholderText('Search bugs, files, teams...')).toBeDefined();
  });

  it('shows Dashboard as default page title', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    // The header title should show 'Dashboard' on the root route
    const headers = screen.getAllByText('Dashboard');
    expect(headers.length).toBeGreaterThan(0);
  });
});
