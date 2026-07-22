import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faTooth,
  faUsers,
  faUserDoctor,
  faList,
  faCalendarDays,
  faUserGear,
  faRightFromBracket,
  faDatabase,
  faWallet,
  faSackDollar,
  faTruck,
  faBoxesStacked,
  faFileInvoiceDollar,
  faMoneyCheckDollar,
  faGear,
  faGauge,
  faBook,
} from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../contexts/AuthContext'
import GlobalSearch from './GlobalSearch'

interface NavItem {
  to: string
  label: string
  icon: typeof faGauge
  permission: string | null
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: 'عام',
    items: [{ to: '/', label: 'لوحة التحكم', icon: faGauge, permission: null }],
  },
  {
    label: 'العيادة',
    items: [
      { to: '/patients', label: 'المرضى', icon: faUsers, permission: 'patients.view' },
      { to: '/appointments', label: 'المواعيد', icon: faCalendarDays, permission: 'appointments.view' },
      { to: '/doctors', label: 'الأطباء', icon: faUserDoctor, permission: 'doctors.view' },
      { to: '/services', label: 'الخدمات', icon: faList, permission: 'services.view' },
    ],
  },
  {
    label: 'المالية',
    items: [
      { to: '/cash', label: 'الصناديق والمصاريف', icon: faWallet, permission: 'cash.view' },
      { to: '/commissions', label: 'الرواتب والعمولات', icon: faSackDollar, permission: 'commissions.view' },
      { to: '/checks', label: 'الشيكات', icon: faMoneyCheckDollar, permission: 'checks.view' },
      { to: '/debts', label: 'دفتر الديون', icon: faBook, permission: null },
    ],
  },
  {
    label: 'المخزون والمشتريات',
    items: [
      { to: '/suppliers', label: 'الموردون', icon: faTruck, permission: 'suppliers.view' },
      { to: '/items', label: 'الأصناف والمخزون', icon: faBoxesStacked, permission: 'inventory.view' },
      { to: '/purchase-invoices', label: 'فواتير الشراء', icon: faFileInvoiceDollar, permission: 'purchasing.view' },
    ],
  },
  {
    label: 'الإدارة',
    items: [
      { to: '/users', label: 'المستخدمون', icon: faUserGear, permission: 'users.view' },
      { to: '/backups', label: 'النسخ الاحتياطي', icon: faDatabase, permission: 'settings.manage' },
      { to: '/settings', label: 'الإعدادات', icon: faGear, permission: null },
    ],
  },
]

function pageTitle(pathname: string): string {
  for (const group of navGroups) {
    for (const item of group.items) {
      const isMatch = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
      if (isMatch) return item.label
    }
  }
  return pathname.startsWith('/patients/') ? 'ملف المريض' : 'DentaFlow'
}

export default function Layout() {
  const { data, can, logout } = useAuth()
  const location = useLocation()

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-64 shrink-0 flex-col border-l border-border bg-surface">
        <div className="flex items-center gap-3 px-6 py-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-white">
            <FontAwesomeIcon icon={faTooth} />
          </span>
          <span className="text-lg font-semibold text-ink">DentaFlow</span>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => item.permission === null || can(item.permission))
            if (items.length === 0) return null

            return (
              <div key={group.label}>
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted/70">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                          isActive ? 'bg-accent text-white shadow-sm' : 'text-ink/70 hover:bg-background'
                        }`
                      }
                    >
                      <FontAwesomeIcon icon={item.icon} className="w-4" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            )
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-background px-3 py-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {data?.user.name?.charAt(0)}
            </span>
            <p className="truncate text-sm text-ink/80">{data?.user.name}</p>
          </div>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-background hover:text-ink"
          >
            <FontAwesomeIcon icon={faRightFromBracket} className="w-4" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-8 py-4">
          <h2 className="text-sm font-medium text-muted">{pageTitle(location.pathname)}</h2>
          <GlobalSearch />
        </header>
        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
