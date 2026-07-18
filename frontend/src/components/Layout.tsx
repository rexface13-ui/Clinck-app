import { NavLink, Outlet } from 'react-router-dom'
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
} from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../contexts/AuthContext'

const navItems = [
  { to: '/patients', label: 'المرضى', icon: faUsers, permission: 'patients.view' },
  { to: '/appointments', label: 'المواعيد', icon: faCalendarDays, permission: 'appointments.view' },
  { to: '/doctors', label: 'الأطباء', icon: faUserDoctor, permission: 'doctors.view' },
  { to: '/services', label: 'الخدمات', icon: faList, permission: 'services.view' },
  { to: '/cash', label: 'الصناديق والمصاريف', icon: faWallet, permission: 'cash.view' },
  { to: '/commissions', label: 'عمولات الأطباء', icon: faSackDollar, permission: 'commissions.view' },
  { to: '/suppliers', label: 'الموردون', icon: faTruck, permission: 'suppliers.view' },
  { to: '/items', label: 'الأصناف والمخزون', icon: faBoxesStacked, permission: 'inventory.view' },
  { to: '/purchase-invoices', label: 'فواتير الشراء', icon: faFileInvoiceDollar, permission: 'purchasing.view' },
  { to: '/checks', label: 'الشيكات', icon: faMoneyCheckDollar, permission: 'checks.view' },
  { to: '/users', label: 'المستخدمون', icon: faUserGear, permission: 'users.view' },
  { to: '/backups', label: 'النسخ الاحتياطي', icon: faDatabase, permission: 'settings.manage' },
]

export default function Layout() {
  const { data, can, logout } = useAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col bg-white shadow-sm">
        <div className="flex items-center gap-3 p-6">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-white">
            <FontAwesomeIcon icon={faTooth} />
          </span>
          <span className="text-lg font-semibold text-ink">DentaFlow</span>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {navItems
            .filter((item) => can(item.permission))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition-colors ${
                    isActive ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'
                  }`
                }
              >
                <FontAwesomeIcon icon={item.icon} className="w-4" />
                {item.label}
              </NavLink>
            ))}
        </nav>

        <div className="border-t border-ink/10 p-4">
          <p className="mb-2 truncate text-sm text-ink/70">{data?.user.name}</p>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink/70 hover:bg-background"
          >
            <FontAwesomeIcon icon={faRightFromBracket} className="w-4" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
