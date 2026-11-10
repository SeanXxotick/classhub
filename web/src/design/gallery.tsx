/*
 * Dev-only gallery: every shared component in every state. Open /gallery.html while `npm run dev`
 * runs (or let design/gallery-check.mjs do it). It imports nothing from data/ or Firebase.
 */
import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/roboto';
import './tokens.css';
import './components.css';
import './gallery.css';
import {
  ACCENT_COLORS,
  AmountInput,
  AppShell,
  Accented,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ClassLogo,
  ConfirmDialog,
  DayHeader,
  Dialog,
  EmptyState,
  Fab,
  Field,
  FilterChips,
  HeroCard,
  Icon,
  IconButton,
  ICON_NAMES,
  ListRow,
  Money,
  Notice,
  RadioGroup,
  RoleTag,
  Row,
  SearchInput,
  Section,
  SegmentedControl,
  Select,
  SidebarBrand,
  SidebarItem,
  SidebarLabel,
  SidebarPlus,
  SidebarSpacer,
  Skeleton,
  SkeletonList,
  Spinner,
  Stack,
  StatusBadge,
  Swatches,
  Switch,
  Tile,
  Tiles,
  TextArea,
  TextInput,
  TopBar,
  TypeIcon,
  useSnackbar,
  type TabDef,
  type Tone,
} from './index';

const TABS: TabDef[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'ledger', label: 'Ledger', icon: 'ledger' },
  { id: 'schedule', label: 'Schedule', icon: 'schedule' },
  { id: 'contents', label: 'Contents', icon: 'contents' },
  { id: 'news', label: 'Announcements', shortLabel: 'News', icon: 'news' },
  { id: 'members', label: 'Members', icon: 'members', badge: 2 },
];

const TOKENS = ['--ch-bg', '--ch-surface', '--ch-surface-2', '--ch-text', '--ch-text-muted', '--ch-border', '--ch-primary', '--ch-primary-soft', '--ch-income', '--ch-charge', '--ch-withdrawal', '--ch-payout', '--ch-opening', '--ch-success', '--ch-warning', '--ch-danger', '--ch-info'];
const LONG_NAME = 'Maria Cristina Alexandra Villanueva-De Los Santos Jr.';
const COURSES = ['CS 201 Data Structures', 'CS 205 Computer Organization', 'MATH 210 Discrete Mathematics'];

type Theme = 'light' | 'dark';

function Gallery() {
  const [theme, setTheme] = useState<Theme>('light');
  const [accent, setAccent] = useState(ACCENT_COLORS[0]);
  const [tab, setTab] = useState('home');
  const { show, snackbar } = useSnackbar();

  // inputs
  const [text, setText] = useState('Elena Bautista');
  const [amount, setAmount] = useState('1,250.00');
  const [bad, setBad] = useState('abc');
  const [course, setCourse] = useState(COURSES[0]);
  const [note, setNote] = useState('A note for the record');
  const [query, setQuery] = useState('');
  const [swOn, setSwOn] = useState(true);
  const [swOff, setSwOff] = useState(false);
  const [check, setCheck] = useState(true);
  const [vis, setVis] = useState('OFFICERS');
  const [method, setMethod] = useState('GCASH');
  const [filter, setFilter] = useState('ALL');
  const [swatch, setSwatch] = useState(ACCENT_COLORS[2]);

  // actions
  const [clicks, setClicks] = useState(0);
  const [busyClicks, setBusyClicks] = useState(0);
  const [formSubmits, setFormSubmits] = useState(0);

  // overlays
  const [dlg, setDlg] = useState<null | 'plain' | 'void' | 'delete' | 'busy'>(null);
  const [saving, setSaving] = useState(false);
  const [busyDialog, setBusyDialog] = useState(true);
  const [confirmed, setConfirmed] = useState('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function confirmWithDelay(label: string, reason: string) {
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      setDlg(null);
      setConfirmed(`${label}${reason ? `: ${reason}` : ''}`);
      show(`${label}.`);
    }, 500);
  }

  const toneBadges: Array<[Tone, string]> = [
    ['income', 'Payment'],
    ['charge', 'Charge'],
    ['withdrawal', 'Withdrawal'],
    ['payout', 'Pay-out'],
    ['opening', 'Opening'],
    ['info', 'GCash'],
    ['primary', 'New this week'],
  ];

  const sidebar = (
    <>
      <SidebarBrand />
      <SidebarLabel>My classes</SidebarLabel>
      <SidebarItem active leading={<ClassLogo name="BSCS 2B" />} onClick={() => undefined}>
        BSCS 2B
      </SidebarItem>
      <SidebarItem leading={<ClassLogo name="CS Organization Officers" color="#585BE8" />} onClick={() => undefined}>
        CS Organization Officers
      </SidebarItem>
      <SidebarItem leading={<SidebarPlus />} onClick={() => undefined}>
        Join with a code
      </SidebarItem>
      <SidebarSpacer />
      <SidebarItem leading={<Avatar name="Ana Reyes" size={30} />} onClick={() => undefined}>
        Ana Reyes
      </SidebarItem>
    </>
  );

  return (
    <Accented color={accent}>
      <AppShell
        sidebar={sidebar}
        topBar={<TopBar title="Components" onBack={() => undefined} backLabel="Classes" actions={<IconButton icon="sliders" label="Settings" onClick={() => show('Settings would open.')} />} />}
        tabs={{ tabs: TABS, current: tab, onSelect: setTab }}
        fab={<Fab label="New record" onClick={() => show('The record chooser would open.')} />}
      >
        <Stack gap="large">
          <Section title="Theme and accent">
            <Card>
              <Stack>
                <Field label="Theme">
                  <SegmentedControl
                    options={[
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                    value={theme}
                    onChange={(v) => setTheme(v as Theme)}
                    full
                  />
                </Field>
                <Field label="Class accent color">
                  <Swatches colors={ACCENT_COLORS} value={accent} onChange={setAccent} />
                </Field>
                <p className="ch-muted ch-small" style={{ margin: 0 }}>
                  The tabs below only move the highlight. Resize the window below 900px to see the bottom navigation.
                </p>
              </Stack>
            </Card>
          </Section>

          <Section title="Color tokens">
            <Card>
              <div className="gg-wrap">
                {TOKENS.map((t) => (
                  <div className="gg-tok" key={t}>
                    <i style={{ background: `var(${t})` }} />
                    <span>{t.slice(5)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </Section>

          <Section title="Type and money">
            <Card>
              <Stack gap="small">
                <div style={{ fontSize: 'var(--ch-fs-display)', fontWeight: 800, lineHeight: 1.2 }}>Display 32 / 800</div>
                <div style={{ fontSize: 'var(--ch-fs-headline)', fontWeight: 700 }}>Headline 24 / 700</div>
                <div style={{ fontSize: 'var(--ch-fs-title)', fontWeight: 700 }}>Title 20 / 700</div>
                <div style={{ fontSize: 'var(--ch-fs-lead)', fontWeight: 600 }}>Lead 16 / 600</div>
                <div>Body 15 / 400. The quick brown fox jumps over the lazy dog.</div>
                <div className="ch-small ch-muted">Small 13 / 400, muted</div>
                <div className="ch-caption ch-muted">Caption 12, labels and badges</div>
                <Row wrap>
                  <Money centavos={123456789} size="big" />
                  <span className="ch-muted ch-small">tabular figures, never wraps</span>
                </Row>
                <Row wrap>
                  <Money centavos={111111} size="mid" />
                  <Money centavos={888888} size="mid" />
                  <Money centavos={-2500} sign />
                  <Money centavos={20000} sign tone="income" />
                  <Money centavos={-17400} tone="charge" />
                  <Money centavos={-50000} tone="withdrawal" />
                  <Money centavos={-775000} tone="payout" />
                  <Money centavos={-4500} tone="opening" />
                  <Money centavos={15000} tone="income" voided />
                </Row>
              </Stack>
            </Card>
          </Section>

          <Section title="Buttons">
            <Card>
              <Stack>
                <div className="gg-wrap">
                  <Button variant="solid" onClick={() => setClicks(clicks + 1)}>
                    Solid
                  </Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="text">Text</Button>
                  <Button variant="outline" danger>
                    Danger
                  </Button>
                  <Button danger>Delete</Button>
                  <Button variant="text" danger icon="trash">
                    Delete account
                  </Button>
                  <Button disabled>Disabled</Button>
                  <Button icon="plus">With icon</Button>
                  <Button count={3} icon="list">
                    Claims
                  </Button>
                  <Button variant="outline" size="small">
                    Small
                  </Button>
                  <Button busy onClick={() => setBusyClicks(busyClicks + 1)}>
                    Saving
                  </Button>
                  <Button variant="outline" busy>
                    Busy outline
                  </Button>
                </div>
                <div className="ch-muted ch-small">
                  Solid clicks: <span data-testid="clicks">{clicks}</span>. Clicks that reached the busy button: <span data-testid="busy-clicks">{busyClicks}</span>.
                </div>
                <Button size="big" block>
                  Big block button
                </Button>
                <Row>
                  <IconButton icon="sliders" label="Settings" />
                  <IconButton icon="edit" label="Edit course" />
                  <IconButton icon="trash" label="Delete" />
                </Row>
              </Stack>
            </Card>
          </Section>

          <Section title="Inputs and pickers">
            <Card>
              <Stack>
                <Field label="Text" hint="Shown under the field.">
                  <TextInput value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
                <Field label="Amount" hint="Money uses tabular figures.">
                  <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="With an error" error="Enter an amount greater than zero.">
                  <TextInput value={bad} onChange={(e) => setBad(e.target.value)} />
                </Field>
                <Field label="Select">
                  <Select value={course} onChange={(e) => setCourse(e.target.value)}>
                    {COURSES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Textarea">
                  <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <SearchInput aria-label="Search sample" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="ch-card ch-flush" style={{ boxShadow: 'none', border: '1px solid var(--ch-border)' }}>
                  <Switch checked={swOn} onChange={setSwOn} label="Switch on" description="With a short description" />
                  <Switch checked={swOff} onChange={setSwOff} label="Switch off" />
                  <Switch checked={false} onChange={() => undefined} label="Switch disabled" disabled />
                  <Checkbox checked={check} onChange={setCheck} label="Checkbox" />
                </div>
                <Field label="Who can see balances">
                  <RadioGroup
                    options={[
                      { value: 'EVERYONE', label: 'Whole class', description: 'Every member sees every record and balance.' },
                      { value: 'OFFICERS', label: 'Officers only', description: 'Anyone whose role has a permission sees them.' },
                      { value: 'TREASURERS', label: 'Treasurers only', description: 'Only roles that manage the ledger see them.' },
                    ]}
                    value={vis}
                    onChange={setVis}
                  />
                </Field>
                <Field label="Payment method">
                  <SegmentedControl
                    options={[
                      { value: 'GCASH', label: 'GCash' },
                      { value: 'MAYA', label: 'Maya' },
                      { value: 'BANK', label: 'Bank' },
                    ]}
                    value={method}
                    onChange={setMethod}
                  />
                </Field>
                <FilterChips
                  label="Filter records"
                  options={[
                    { value: 'ALL', label: 'All' },
                    { value: 'PAYMENT', label: 'Payments' },
                    { value: 'CHARGE', label: 'Charges' },
                    { value: 'WITHDRAWAL', label: 'Withdrawals' },
                    { value: 'EXPENSE', label: 'Pay-outs' },
                    { value: 'OPENING', label: 'Opening' },
                    { value: 'VOID', label: 'Voided' },
                  ]}
                  value={filter}
                  onChange={setFilter}
                />
                <Field label="Color">
                  <Swatches colors={ACCENT_COLORS} value={swatch} onChange={setSwatch} />
                </Field>
              </Stack>
            </Card>
          </Section>

          <Section title="Cards">
            <div className="gg-grid">
              <Card>
                <div className="ch-semibold">Plain card</div>
                <div className="ch-muted ch-small">Surface, radius 16, soft shadow.</div>
              </Card>
              <Card tinted>
                <Row>
                  <ClassLogo name="BSCS 2B" size={52} />
                  <div className="ch-grow">
                    <div className="ch-semibold">Tinted card</div>
                    <div className="ch-muted ch-small">Used for the class header.</div>
                  </div>
                </Row>
              </Card>
              <HeroCard centavos={12345} action={<Button variant="outline" size="small">My statement</Button>} />
              <HeroCard centavos={-3500} />
              <HeroCard centavos={0} label="Your balance" />
              <Card>
                <Row>
                  <h3 className="ch-card-title ch-grow">Class fund</h3>
                  <StatusBadge status="success">Books balanced</StatusBadge>
                </Row>
                <div className="ch-muted ch-small ch-semibold" style={{ marginTop: 8 }}>
                  Cash on hand
                </div>
                <Money centavos={425000} size="big" />
                <Tiles>
                  <Tile label="Waiting to be paid out">
                    <Money centavos={17400} size="mid" />
                  </Tile>
                  <Tile label="Available cash">
                    <Money centavos={407600} size="mid" />
                  </Tile>
                </Tiles>
              </Card>
            </div>
          </Section>

          <Section title="List rows">
            <Card flush>
              <DayHeader>Today</DayHeader>
              <ListRow
                onClick={() => show('Payment opened.')}
                leading={<Avatar name="Ana Reyes" badge={{ icon: 'income', tone: 'income' }} />}
                title="Ana Reyes"
                subtitle="Payment · Class fund for November"
                trailing={<Money centavos={20000} sign tone="income" />}
              />
              <ListRow
                onClick={() => show('Charge opened.')}
                leading={<TypeIcon icon="charge" tone="charge" />}
                title="Printing: CS 201 handouts"
                subtitle="Charge · 29 students x ₱6.00"
                trailing={
                  <>
                    <Money centavos={-17400} sign tone="charge" />
                    <StatusBadge status="warning">Not yet paid out</StatusBadge>
                  </>
                }
              />
              <DayHeader>Yesterday</DayHeader>
              <ListRow
                onClick={() => show('Withdrawal opened.')}
                leading={<Avatar name="Ben Santos" badge={{ icon: 'withdrawal', tone: 'withdrawal' }} />}
                title="Ben Santos"
                subtitle="Withdrawal · Refund for the cancelled trip"
                trailing={<Money centavos={-50000} sign tone="withdrawal" />}
              />
              <DayHeader>Sat, Nov 7</DayHeader>
              <ListRow
                onClick={() => show('Pay-out opened.')}
                leading={<TypeIcon icon="payout" tone="payout" size={40} />}
                title="Kuya Rey Tailoring"
                subtitle="Pay-out · Settles the Class shirts charge"
                trailing={<Money centavos={-775000} sign tone="payout" />}
              />
              <DayHeader>Mon, Nov 2</DayHeader>
              <ListRow
                onClick={() => show('Opening balance opened.')}
                leading={<Avatar name="Dan Cruz" badge={{ icon: 'flag', tone: 'opening' }} />}
                title="Dan Cruz"
                subtitle="Opening balance · Carried over from the first semester"
                trailing={<Money centavos={-4500} sign tone="opening" />}
              />
              <DayHeader>Fri, Nov 6</DayHeader>
              <ListRow
                voided
                onClick={() => show('Voided record opened.')}
                leading={<Avatar name={LONG_NAME} badge={{ icon: 'income', tone: 'income' }} />}
                title={LONG_NAME}
                subtitle="Payment · Class fund"
                trailing={
                  <>
                    <Money centavos={15000} sign tone="income" voided />
                    <StatusBadge status="neutral">Voided</StatusBadge>
                  </>
                }
              >
                <span className="ch-small ch-text-danger ch-block">Voided: Entered twice by mistake</span>
              </ListRow>
            </Card>
            <Card flush>
              <ListRow leading={<TypeIcon icon="pin" tone="primary" />} title="Midterm week reminders" subtitle="The midterm exam in CS 201 is on Friday, Nov 20, at 8:00 AM in Room 301." chevron onClick={() => show('Announcement opened.')} />
              <ListRow
                render={(p) => (
                  <a {...p} href="#link-row" onClick={(e) => e.preventDefault()}>
                    {p.children}
                  </a>
                )}
                leading={<TypeIcon icon="link" tone="info" />}
                title="Visualgo: step by step animations"
                subtitle="Added by Carlo Dizon, Oct 28 (this row is a link)"
                chevron
              />
              <ListRow
                leading={<Avatar name="Rafael Ocampo" size={40} />}
                title="Rafael Ocampo"
                subtitle="Asked Today, 8:40 AM"
                actions={
                  <>
                    <Button variant="outline" danger size="small">
                      Reject
                    </Button>
                    <Button size="small">Approve</Button>
                  </>
                }
              />
              <ListRow done title="Lab report 5" subtitle="CS 205 · Mon, Nov 9" trailing={<Badge tone="primary">Deadline</Badge>} />
            </Card>
          </Section>

          <Section title="Badges">
            <Card>
              <div className="gg-wrap">
                {toneBadges.map(([tone, label]) => (
                  <Badge key={tone} tone={tone}>
                    {label}
                  </Badge>
                ))}
                <StatusBadge status="success">Paid out</StatusBadge>
                <StatusBadge status="warning">Not yet paid out</StatusBadge>
                <StatusBadge status="danger">Overdue</StatusBadge>
                <StatusBadge status="info">Waiting for the Treasurer</StatusBadge>
                <StatusBadge status="neutral">Voided</StatusBadge>
                <RoleTag name="Mayor" color="#3730A3" />
                <RoleTag name="Treasurer" color="#15803D" />
                <RoleTag name="Secretary" color="#0369A1" />
                <RoleTag name="Member" color="#6B768A" />
              </div>
            </Card>
          </Section>

          <Section title="Notices">
            <Stack>
              <Notice tone="info" title="Information">
                Something worth knowing. Nothing is blocked.
              </Notice>
              <Notice tone="warning" title="Check this">
                Ben Santos would owe the class ₱256.00.
              </Notice>
              <Notice tone="danger" title="Voided" icon="ban">
                Voided by Ana Reyes on Nov 6, 2:41 PM.
              </Notice>
              <Notice tone="success" title="Done">
                The payment was recorded.
              </Notice>
              <Notice tone="info" icon="lock">
                A notice without a title.
              </Notice>
            </Stack>
          </Section>

          <Section title="Dialogs">
            <Card>
              <Stack>
                <form
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    setFormSubmits(formSubmits + 1);
                  }}
                >
                  <div className="gg-wrap">
                    <Button variant="outline" onClick={() => setDlg('plain')}>
                      Open dialog
                    </Button>
                    <Button variant="outline" danger onClick={() => setDlg('void')}>
                      Void with a reason
                    </Button>
                    <Button variant="outline" danger onClick={() => setDlg('delete')}>
                      Delete class
                    </Button>
                    <Button variant="outline" onClick={() => { setBusyDialog(true); setDlg('busy'); }}>
                      Busy dialog
                    </Button>
                  </div>
                </form>
                <div className="ch-muted ch-small">
                  These buttons sit inside a form. Form submits caused by the dialogs: <span data-testid="submits">{formSubmits}</span>. Last result: <span data-testid="confirmed">{confirmed || 'none'}</span>.
                </div>
              </Stack>
            </Card>
          </Section>

          <Section title="Empty and loading states">
            <div className="gg-grid">
              <Card>
                <EmptyState icon="ledger" title="No records yet" action={<Button icon="plus">New record</Button>}>
                  Payments and charges show here.
                </EmptyState>
              </Card>
              <Card>
                <Stack>
                  <Row>
                    <Spinner />
                    <span className="ch-muted">Loading the ledger</span>
                  </Row>
                  <SkeletonList rows={2} />
                  <Skeleton height={32} />
                </Stack>
              </Card>
            </div>
          </Section>

          <Section title="Snackbar">
            <Card>
              <Button variant="outline" onClick={() => show('Payment saved.')}>
                Show a message
              </Button>
            </Card>
          </Section>

          <Section title="Icons">
            <Card>
              <div className="gg-icons">
                {ICON_NAMES.map((n) => (
                  <div className="gg-icon" key={n}>
                    <Icon name={n} size={24} />
                    {n}
                  </div>
                ))}
              </div>
            </Card>
          </Section>
        </Stack>
      </AppShell>

      <Dialog
        open={dlg === 'plain'}
        title="Edit the note"
        onClose={() => setDlg(null)}
        actions={
          <>
            <Button variant="text" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button onClick={() => { setDlg(null); show('Saved.'); }}>Save</Button>
          </>
        }
      >
        <p>This dialog traps focus. Press Escape or tap the dim background to close it.</p>
        <Field label="Note">
          <TextInput defaultValue="Class fund for November" />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={dlg === 'void'}
        title="Void this payment?"
        confirmLabel="Void record"
        reason={{ label: 'Reason for voiding' }}
        busy={saving}
        onCancel={() => setDlg(null)}
        onConfirm={(reason) => confirmWithDelay('Record voided', reason)}
      >
        <p>Ana Reyes, ₱200.00. The record stays in the list, crossed out, with your name and this reason. It is left out of every total.</p>
        <Notice tone="warning">This cannot be undone.</Notice>
      </ConfirmDialog>

      <ConfirmDialog
        open={dlg === 'delete'}
        title="Delete this class?"
        confirmLabel="Delete class"
        typeToConfirm={{ label: 'Type the class name to confirm', expected: 'BSCS 2B' }}
        busy={saving}
        onCancel={() => setDlg(null)}
        onConfirm={() => confirmWithDelay('Class deleted', '')}
      >
        <p>Deleting the class removes every record, charge and member.</p>
      </ConfirmDialog>

      <Dialog
        open={dlg === 'busy'}
        title="Saving"
        busy={busyDialog}
        onClose={() => setDlg(null)}
        actions={
          <Button variant="outline" onClick={() => (busyDialog ? setBusyDialog(false) : setDlg(null))}>
            {busyDialog ? 'Stop the spinner' : 'Close'}
          </Button>
        }
      >
        <Row>
          <Spinner />
          <span>{busyDialog ? 'Escape and the background do nothing while the dialog is busy.' : 'Done. Escape works again.'}</span>
        </Row>
      </Dialog>

      {snackbar}
    </Accented>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
