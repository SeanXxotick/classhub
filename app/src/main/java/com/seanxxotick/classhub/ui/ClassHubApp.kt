package com.seanxxotick.classhub.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.CompositionLocalProvider
import com.seanxxotick.classhub.settings.AppSettings
import com.seanxxotick.classhub.settings.ThemeMode
import com.seanxxotick.classhub.ui.account.AccountScreen
import com.seanxxotick.classhub.ui.account.AccountViewModel
import com.seanxxotick.classhub.ui.theme.LocalDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.seanxxotick.classhub.data.model.AppUser
import com.seanxxotick.classhub.data.model.RecordType
import androidx.navigation.NavType
import androidx.navigation.navArgument
import com.seanxxotick.classhub.ui.contents.ContentFormScreen
import com.seanxxotick.classhub.ui.schedule.ScheduleFormScreen
import com.seanxxotick.classhub.ui.ledger.ChargeStudentsScreen
import com.seanxxotick.classhub.ui.ledger.PayoutFormScreen
import com.seanxxotick.classhub.ui.ledger.RecordFormScreen
import com.seanxxotick.classhub.ui.auth.AuthScreen
import com.seanxxotick.classhub.ui.auth.AuthViewModel
import com.seanxxotick.classhub.ui.auth.Session
import com.seanxxotick.classhub.ui.classes.ClassesScreen
import com.seanxxotick.classhub.ui.classes.ClassesViewModel
import com.seanxxotick.classhub.ui.classes.CreateClassScreen
import com.seanxxotick.classhub.ui.classes.JoinClassScreen
import com.seanxxotick.classhub.ui.classroom.ClassScreen
import com.seanxxotick.classhub.ui.classroom.ClassSettingsScreen
import com.seanxxotick.classhub.ui.classroom.ClassViewModel
import com.seanxxotick.classhub.ui.classroom.CoursesScreen
import com.seanxxotick.classhub.ui.classroom.MemberDetailScreen
import com.seanxxotick.classhub.ui.classroom.RoleEditorScreen
import com.seanxxotick.classhub.ui.classroom.RolesScreen
import com.seanxxotick.classhub.ui.theme.ClassHubTheme

/** Root of the app: shows sign-in when signed out, otherwise the class navigation. */
@Composable
fun ClassHubApp(authVm: AuthViewModel = viewModel()) {
    val session by authVm.session.collectAsState()
    val dark = when (AppSettings.themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    CompositionLocalProvider(LocalDarkTheme provides dark) {
        ClassHubTheme(darkTheme = dark) {
            Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                when (val s = session) {
                    Session.Loading -> Box(Modifier.fillMaxSize()) {
                        CircularProgressIndicator(Modifier.align(Alignment.Center))
                    }
                    Session.SignedOut -> {
                        val ui by authVm.ui.collectAsState()
                        AuthScreen(ui, authVm::signIn, authVm::signUp, authVm::clearError)
                    }
                    is Session.SignedIn -> SignedInApp(s.user, onSignOut = authVm::signOut)
                }
            }
        }
    }
}

private object Routes {
    const val CLASSES = "classes"
    const val ACCOUNT = "account"
    const val CREATE = "create"
    const val JOIN = "join"
    const val CLASS = "class/{classId}"
    const val MEMBER = "class/{classId}/member/{memberId}"
    const val ROLES = "class/{classId}/roles"
    const val ROLE = "class/{classId}/roles/{roleId}"
    const val COURSES = "class/{classId}/courses"
    const val SETTINGS = "class/{classId}/settings"
    const val RECORD = "class/{classId}/record/{type}?batch={batch}"
    const val CHARGE = "class/{classId}/charge"
    const val CONTENT = "class/{classId}/content/{contentId}"
    const val SCHEDULE_ITEM = "class/{classId}/schedule/{itemId}?day={day}"
    const val NEW_CONTENT = "new"
    const val NEW_ROLE = "new"

    fun classRoute(classId: String) = "class/$classId"
    fun memberRoute(classId: String, memberId: String) = "class/$classId/member/$memberId"
    fun rolesRoute(classId: String) = "class/$classId/roles"
    fun roleRoute(classId: String, roleId: String) = "class/$classId/roles/$roleId"
    fun coursesRoute(classId: String) = "class/$classId/courses"
    fun settingsRoute(classId: String) = "class/$classId/settings"
    fun recordRoute(classId: String, type: RecordType) =
        if (type == RecordType.CHARGE) "class/$classId/charge" else "class/$classId/record/${type.name}"
    fun contentRoute(classId: String, contentId: String) = "class/$classId/content/$contentId"
    fun scheduleItemRoute(classId: String, itemId: String, dayEpoch: Long? = null) =
        "class/$classId/schedule/$itemId" + (dayEpoch?.let { "?day=$it" } ?: "")
    fun payoutRoute(classId: String, batchId: String) = "class/$classId/record/${RecordType.EXPENSE.name}?batch=$batchId"
}

/**
 * The class screen and its management screens share one [ClassViewModel], scoped to the class
 * screen's back-stack entry, so they all see the same live data.
 */
@Composable
private fun classViewModel(nav: NavHostController, entry: NavBackStackEntry, user: AppUser): ClassViewModel {
    val classId = entry.arguments?.getString("classId").orEmpty()
    val owner = remember(entry) { if (entry.destination.route == Routes.CLASS) entry else nav.getBackStackEntry(Routes.CLASS) }
    return viewModel(viewModelStoreOwner = owner, key = "class-$classId") { ClassViewModel(classId, user.uid) }
}

@Composable
private fun SignedInApp(user: AppUser, onSignOut: () -> Unit) {
    val nav = rememberNavController()
    val classesVm: ClassesViewModel = viewModel(key = "classes-${user.uid}") { ClassesViewModel(user.uid) }

    NavHost(navController = nav, startDestination = Routes.CLASSES) {
        composable(Routes.CLASSES) {
            val classes by classesVm.classes.collectAsState()
            val classPhotos by classesVm.classPhotos.collectAsState()
            val action by classesVm.action.collectAsState()
            ClassesScreen(
                user = user,
                classes = classes,
                classPhotos = classPhotos,
                error = action.error,
                onOpenClass = { nav.navigate(Routes.classRoute(it)) },
                onCreate = { classesVm.clearError(); nav.navigate(Routes.CREATE) },
                onJoin = { classesVm.clearError(); nav.navigate(Routes.JOIN) },
                onOpenAccount = { nav.navigate(Routes.ACCOUNT) },
            )
        }
        composable(Routes.ACCOUNT) {
            val accountVm: AccountViewModel = viewModel(key = "account-${user.uid}") { AccountViewModel(user.uid) }
            val photo by accountVm.photo.collectAsState()
            val busy by accountVm.busy.collectAsState()
            val notice by accountVm.notice.collectAsState()
            AccountScreen(
                user = user,
                photo = photo,
                busy = busy,
                notice = notice,
                onSetPhoto = accountVm::setPhoto,
                onRemovePhoto = accountVm::removePhoto,
                onPhotoError = accountVm::showNotice,
                onClearNotice = accountVm::clearNotice,
                onSignOut = onSignOut,
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.CREATE) {
            val action by classesVm.action.collectAsState()
            CreateClassScreen(
                state = action,
                onCreate = { name, description, accent ->
                    classesVm.createClass(name, description, accent, user.displayName) { classId ->
                        nav.navigate(Routes.classRoute(classId)) { popUpTo(Routes.CLASSES) }
                    }
                },
                onBack = { nav.popBackStack() },
                onClearError = classesVm::clearError,
            )
        }
        composable(Routes.JOIN) {
            val action by classesVm.action.collectAsState()
            JoinClassScreen(
                state = action,
                onJoin = { code ->
                    classesVm.joinClass(code, user.displayName) { classId ->
                        nav.navigate(Routes.classRoute(classId)) { popUpTo(Routes.CLASSES) }
                    }
                },
                onBack = { nav.popBackStack() },
                onClearError = classesVm::clearError,
            )
        }
        composable(Routes.CLASS) { entry ->
            val classId = entry.arguments?.getString("classId").orEmpty()
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            val progress by vm.allProgress.collectAsState()
            ClassScreen(
                state = state,
                myUid = user.uid,
                busy = busy,
                notice = notice,
                onRegenerateCode = vm::regenerateInviteCode,
                onOpenMember = { nav.navigate(Routes.memberRoute(classId, it)) },
                onOpenRoles = { nav.navigate(Routes.rolesRoute(classId)) },
                onOpenCourses = { nav.navigate(Routes.coursesRoute(classId)) },
                onOpenSettings = { nav.navigate(Routes.settingsRoute(classId)) },
                onAddRecord = { type -> nav.navigate(Routes.recordRoute(classId, type)) },
                onDeleteRecord = vm::deleteRecord,
                onUndoCharge = vm::undoCharge,
                onRecordPayout = { batchId -> nav.navigate(Routes.payoutRoute(classId, batchId)) },
                onAddContent = { nav.navigate(Routes.contentRoute(classId, Routes.NEW_CONTENT)) },
                onEditContent = { id -> nav.navigate(Routes.contentRoute(classId, id)) },
                onAddScheduleItem = { day -> nav.navigate(Routes.scheduleItemRoute(classId, Routes.NEW_CONTENT, day)) },
                onEditScheduleItem = { id -> nav.navigate(Routes.scheduleItemRoute(classId, id)) },
                progress = progress,
                onToggleDone = vm::setDone,
                onSetCancelled = vm::setCancelled,
                onShowNotice = vm::showNotice,
                onClearNotice = vm::clearNotice,
                onRemoved = { vm.forgetClass(); nav.popBackStack(Routes.CLASSES, inclusive = false) },
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.MEMBER) { entry ->
            val memberId = entry.arguments?.getString("memberId").orEmpty()
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            MemberDetailScreen(
                state = state,
                memberId = memberId,
                myUid = user.uid,
                busy = busy,
                notice = notice,
                onSaveRole = { member, roleId -> vm.setRole(member, roleId) },
                onSaveCourses = { member, taken -> vm.setCoursesTaken(member, taken) },
                onRemove = { member -> vm.removeMember(member) { nav.popBackStack() } },
                onClearNotice = vm::clearNotice,
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.ROLES) { entry ->
            val classId = entry.arguments?.getString("classId").orEmpty()
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val notice by vm.notice.collectAsState()
            RolesScreen(
                state = state,
                notice = notice,
                onOpenRole = { nav.navigate(Routes.roleRoute(classId, it)) },
                onNewRole = { nav.navigate(Routes.roleRoute(classId, Routes.NEW_ROLE)) },
                onClearNotice = vm::clearNotice,
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.ROLE) { entry ->
            val roleId = entry.arguments?.getString("roleId").orEmpty()
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            RoleEditorScreen(
                state = state,
                roleId = roleId.takeUnless { it == Routes.NEW_ROLE },
                busy = busy,
                notice = notice,
                onSave = { role -> vm.saveRole(role) { nav.popBackStack() } },
                onDelete = { role -> vm.deleteRole(role) { nav.popBackStack() } },
                onClearNotice = vm::clearNotice,
                onBack = { nav.popBackStack() },
            )
        }
        composable(
            Routes.RECORD,
            arguments = listOf(navArgument("batch") { type = NavType.StringType; defaultValue = "" }),
        ) { entry ->
            val type = runCatching { RecordType.valueOf(entry.arguments?.getString("type").orEmpty()) }.getOrDefault(RecordType.PAYMENT)
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            if (type == RecordType.EXPENSE) {
                PayoutFormScreen(
                    state = state,
                    preselectedBatchId = entry.arguments?.getString("batch").orEmpty(),
                    busy = busy,
                    notice = notice,
                    onSave = { charge, paidTo, date -> vm.addPayout(charge, paidTo, date) { nav.popBackStack() } },
                    onClearNotice = vm::clearNotice,
                    onBack = { nav.popBackStack() },
                )
            } else {
                RecordFormScreen(
                    state = state,
                    type = type,
                    busy = busy,
                    notice = notice,
                    onSave = { record -> vm.addRecord(record) { nav.popBackStack() } },
                    onClearNotice = vm::clearNotice,
                    onBack = { nav.popBackStack() },
                )
            }
        }
        composable(Routes.CHARGE) { entry ->
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            ChargeStudentsScreen(
                state = state,
                busy = busy,
                notice = notice,
                onCharge = { preview, note, courseId, date, payNow, paidTo ->
                    vm.chargeStudents(preview, note, courseId, date, payNow, paidTo) { nav.popBackStack() }
                },
                onClearNotice = vm::clearNotice,
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.CONTENT) { entry ->
            val contentId = entry.arguments?.getString("contentId").orEmpty()
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            ContentFormScreen(
                state = state,
                contentId = contentId.takeUnless { it == Routes.NEW_CONTENT },
                busy = busy,
                notice = notice,
                onSave = { item -> vm.saveContent(item) { nav.popBackStack() } },
                onDelete = { item -> vm.deleteContent(item) { nav.popBackStack() } },
                onError = vm::showNotice,
                onClearNotice = vm::clearNotice,
                onBack = { nav.popBackStack() },
            )
        }
        composable(
            Routes.SCHEDULE_ITEM,
            arguments = listOf(navArgument("day") { type = NavType.LongType; defaultValue = -1L }),
        ) { entry ->
            val itemId = entry.arguments?.getString("itemId").orEmpty()
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            ScheduleFormScreen(
                state = state,
                itemId = itemId.takeUnless { it == Routes.NEW_CONTENT },
                defaultDay = entry.arguments?.getLong("day")?.takeIf { it >= 0 }?.let { java.time.LocalDate.ofEpochDay(it) },
                busy = busy,
                notice = notice,
                onSave = { item -> vm.saveScheduleItem(item) { nav.popBackStack() } },
                onDelete = { item -> vm.deleteScheduleItem(item) { nav.popBackStack() } },
                onClearNotice = vm::clearNotice,
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.SETTINGS) { entry ->
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            ClassSettingsScreen(
                state = state,
                busy = busy,
                notice = notice,
                onSave = { room -> vm.saveSettings(room) { nav.popBackStack() } },
                onSetClassPhoto = vm::setClassPhoto,
                onRemoveClassPhoto = vm::removeClassPhoto,
                onPhotoError = vm::showNotice,
                onClearNotice = vm::clearNotice,
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.COURSES) { entry ->
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            CoursesScreen(
                state = state,
                busy = busy,
                notice = notice,
                onAdd = { name, clear -> vm.addCourse(name, clear) },
                onRename = { course, name -> vm.renameCourse(course, name) },
                onDelete = { course -> vm.deleteCourse(course) },
                onClearNotice = vm::clearNotice,
                onBack = { nav.popBackStack() },
            )
        }
    }
}
