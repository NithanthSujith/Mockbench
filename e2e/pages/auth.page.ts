import type { Page } from '../../apps/web/node_modules/@playwright/test/index.mjs'
import { expect } from '../fixtures'

export interface Account {
  name: string
  email: string
  password: string
}

/** Register, sign in and sign out screens plus the topbar account menu. */
export class AuthPage {
  constructor(private readonly page: Page) {}

  async register(account: Account) {
    await this.page.goto('/register')
    await this.page.getByLabel('Name').fill(account.name)
    await this.page.getByLabel('Email').fill(account.email)
    await this.page.getByLabel('Password').fill(account.password)
    await this.page.getByRole('button', { name: 'Create account' }).click()
  }

  async signIn(account: Pick<Account, 'email' | 'password'>, from = '/login') {
    await this.page.goto(from)
    await this.page.getByLabel('Email').fill(account.email)
    await this.page.getByLabel('Password').fill(account.password)
    await this.page.getByRole('button', { name: 'Sign in' }).click()
  }

  async signOut() {
    await this.page.locator('[data-slot="account-menu"]').click()
    await this.page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(this.page).toHaveURL(/\/login/)
  }
}
