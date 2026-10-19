package com.seanxxotick.classhub.ui

import androidx.compose.ui.platform.LocalContext
import android.widget.Toast
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
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
import androidx.lifecycle.Lifecycle
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
import com.seanxxotick.classhub.ui.auth.ChangePasswordScreen
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
import com.seanxxotick.classhub.ui.classroom.MySettingsScreen
import com.seanxxotick.classhub.ui.classroom.RoleEditorScreen
import com.seanxxotick.classhub.ui.classroom.RolesScreen
import com.seanxxotick.classhub.ui.theme.ClassHubTheme

/** Root of the app: shows sign-in when signed out, otherwise the class navigation. */
@Composable
fun ClassHubApp(
    pendingJoinCode: String? = null,
    onJoinCodeHandled: () -> Unit = {},
    authVm: AuthViewModel = viewModel(),
) {
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
                        AuthScreen(ui, authVm::signIn, authVm::signUp, authVm::sendPasswordReset, authVm::clearError)
                    }
                    is Session.SignedIn -> if (s.user.mustChangePassword) {
                        // Accounts created by the class must pick their own password before anything else.
                        val ui by authVm.ui.collectAsState()
                        ChangePasswordScreen(
                            name = s.user.displayName,
                            forced = true,
                            state = ui,
                            onSubmit = { password, confirm -> authVm.changePassword(password, confirm, s.user.email) },
                            onClearError = authVm::clearError,
                            onLeave = authVm::signOut,
                        )
                    } else {
                        SignedInApp(s.user, onSignOut = authVm::signOut, pendingJoinCode, onJoinCodeHandled, authVm)
                    }
                }
            }
        }
    }
}

private object Routes {
    const val CLASSES = "classes"
    const val ACCOUNT = "account"
    const val PASSWORD = "account/password"
    const val CREATE = "create"
    const val JOIN = "join?code={code}"
    fun joinRoute(code: String = "") = if (code.isEmpty()) "join" else "join?code=$code"
    const val CLASS = "class/{classId}"
    const val MEMBER = "class/{classId}/member/{memberId}"
    const val ROLES = "class/{classId}/roles"
    const val ROLE = "class/{classId}/roles/{roleId}"
    const val COURSES = "class/{classId}/courses"
    const val SETTINGS = "class/{classId}/settings"
    const val MY_SETTINGS = "class/{classId}/mine"
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
    fun mySettingsRoute(classId: String) = "class/$classId/mine"
    fun recordRoute(classId: String, type: RecordType) =
        if (type == RecordType.CHARGE) "class/$classId/charge" else "class/$classId/record/${type.name}"
    fun contentRoute(classId: String, contentId: String) = "class/$classId/content/$contentId"
    fun scheduleItemRoute(classId: String, itemId: String, dayEpoch: Long? = null) =
        "class/$classId/schedule/$itemId" + (dayEpoch?.let { "?day=$it" } ?: "")
    fun payoutRoute(classId: String, batchId: String) = "class/$classId/record/${RecordType.EXPENSE.name}?batch=$batchId"
}

/**
 * Opens [route] only when the tap came from the screen in front. A screen that is still animating away
 * after Back keeps receiving taps for a moment; acting on those opened screens of a class that was
 * already closed, which crashed the app.
 */
private fun NavHostController.openFrom(entry: NavBackStackEntry, route: String) {
    if (entry.lifecycle.currentState == Lifecycle.State.RESUMED) navigate(route)
}

/** Goes back one screen, only from the screen in front, so a quick double tap on Back does not go back twice. */
private fun NavHostController.backFrom(entry: NavBackStackEntry) {
    if (entry.lifecycle.currentState == Lifecycle.State.RESUMED) popBackStack()
}

/**
 * The class screen and its management screens share one [ClassViewModel], scoped to the class
 * screen's back-stack entry, so they all see the same live data.
 */
@Composable
private fun classViewModel(nav: NavHostController, entry: NavBackStackEntry, user: AppUser): ClassViewModel {
    val classId = entry.arguments?.getString("classId").orEmpty()
    // The class screen is normally below this one. If it is already gone (this screen is closing), fall
    // back to this screen's own entry instead of crashing; it loads the same class.
    val owner = remember(entry) {
        if (entry.destination.route == Routes.CLASS) entry
        else runCatching { nav.getBackStackEntry(Routes.CLASS) }.getOrDefault(entry)
    }
    return viewModel(viewModelStoreOwner = owner, key = "class-$classId") { ClassViewModel(classId, user.uid) }
}

@Composable
private fun SignedInApp(
    user: AppUser,
    onSignOut: () -> Unit,
    pendingJoinCode: String?,
    onJoinCodeHandled: () -> Unit,
    authVm: AuthViewModel,
) {
    val nav = rememberNavController()
    val classesVm: ClassesViewModel = viewModel(key = "classes-${user.uid}") { ClassesViewModel(user.uid) }

    // An invite link was opened (now, or before signing in): go to Join with the code filled in.
    LaunchedEffect(pendingJoinCode) {
        if (pendingJoinCode != null) {
            classesVm.clearError()
            nav.navigate(Routes.joinRoute(pendingJoinCode)) { popUpTo(Routes.CLASSES) }
            onJoinCodeHandled()
        }
    }

    NavHost(navController = nav, startDestination = Routes.CLASSES) {
        composable(Routes.CLASSES) { entry ->
            val classes by classesVm.classes.collectAsState()
            val classPhotos by classesVm.classPhotos.collectAsState()
            val action by classesVm.action.collectAsState()
            ClassesScreen(
                user = user,
                classes = classes,
                classPhotos = classPhotos,
                error = action.error,
                onOpenClass = { nav.openFrom(entry, Routes.classRoute(it)) },
                onCreate = { classesVm.clearError(); nav.openFrom(entry, Routes.CREATE) },
                onJoin = { classesVm.clearError(); nav.openFrom(entry, Routes.joinRoute()) },
                onOpenAccount = { nav.openFrom(entry, Routes.ACCOUNT) },
            )
        }
        composable(Routes.ACCOUNT) { entry ->
            val accountVm: AccountViewModel = viewModel(key = "account-${user.uid}") { AccountViewModel(user.uid) }
            val photo by accountVm.photo.collectAsState()
            val busy by accountVm.busy.collectAsState()
            val notice by accountVm.notice.collectAsState()
            val deleteStep by accountVm.deleteStep.collectAsState()
            AccountScreen(
                user = user,
                photo = photo,
                busy = busy,
                notice = notice,
                onSetPhoto = accountVm::setPhoto,
                onRemovePhoto = accountVm::removePhoto,
                onPhotoError = accountVm::showNotice,
                onClearNotice = accountVm::clearNotice,
                onSaveName = accountVm::saveName,
                deleteStep = deleteStep,
                onStartDelete = accountVm::startDelete,
                onCancelDelete = accountVm::cancelDelete,
                onDeleteAccount = accountVm::deleteAccount,
                onSignOut = onSignOut,
                onChangePassword = { authVm.clearError(); nav.openFrom(entry, Routes.PASSWORD) },
                onBack = { nav.backFrom(entry) },
            )
        }
        composable(Routes.PASSWORD) { entry ->
            val ui by authVm.ui.collectAsState()
            ChangePasswordScreen(
                name = user.displayName,
                forced = false,
                state = ui,
                onSubmit = { password, confirm -> authVm.changePassword(password, confirm, user.email) { nav.backFrom(entry) } },
                onClearError = authVm::clearError,
                onLeave = { nav.backFrom(entry) },
            )
        }
        composable(Routes.CREATE) { entry ->
            val action by classesVm.action.collectAsState()
            CreateClassScreen(
                state = action,
                onCreate = { name, description, accent ->
                    classesVm.createClass(name, description, accent, user.displayName) { classId ->
                        nav.navigate(Routes.classRoute(classId)) { popUpTo(Routes.CLASSES) }
                    }
                },
                onBack = { nav.backFrom(entry) },
                onClearError = classesVm::clearError,
            )
        }
        composable(
            Routes.JOIN,
            arguments = listOf(navArgument("code") { type = NavType.StringType; defaultValue = "" }),
        ) { entry ->
            val action by classesVm.action.collectAsState()
            val preview by classesVm.invitePreview.collectAsState()
            JoinClassScreen(
                state = action,
                initialCode = entry.arguments?.getString("code").orEmpty(),
                preview = preview,
                onLookup = classesVm::previewInvite,
                onJoin = { code ->
                    classesVm.joinClass(code, user.displayName) { classId ->
                        nav.navigate(Routes.classRoute(classId)) { popUpTo(Routes.CLASSES) }
                    }
                },
                onBack = { nav.backFrom(entry) },
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
                classId = classId,
                state = state,
                myUid = user.uid,
                busy = busy,
                notice = notice,
                onRegenerateCode = vm::regenerateInviteCode,
                onOpenMember = { nav.openFrom(entry, Routes.memberRoute(classId, it)) },
                onOpenRoles = { nav.openFrom(entry, Routes.rolesRoute(classId)) },
                onOpenCourses = { nav.openFrom(entry, Routes.coursesRoute(classId)) },
                onOpenSettings = { nav.openFrom(entry, Routes.settingsRoute(classId)) },
                onOpenMySettings = { nav.openFrom(entry, Routes.mySettingsRoute(classId)) },
                onAddRecord = { type -> nav.openFrom(entry, Routes.recordRoute(classId, type)) },
                onDeleteRecord = vm::deleteRecord,
                onUndoCharge = vm::undoCharge,
                onRecordPayout = { batchId -> nav.openFrom(entry, Routes.payoutRoute(classId, batchId)) },
                onAddContent = { nav.openFrom(entry, Routes.contentRoute(classId, Routes.NEW_CONTENT)) },
                onEditContent = { id -> nav.openFrom(entry, Routes.contentRoute(classId, id)) },
                onAddScheduleItem = { day -> nav.openFrom(entry, Routes.scheduleItemRoute(classId, Routes.NEW_CONTENT, day)) },
                onEditScheduleItem = { id -> nav.openFrom(entry, Routes.scheduleItemRoute(classId, id)) },
                progress = progress,
                onToggleDone = vm::setDone,
                onSetCancelled = vm::setCancelled,
                onShowNotice = vm::showNotice,
                onClearNotice = vm::clearNotice,
                onRemoved = { vm.forgetClass(); nav.popBackStack(Routes.CLASSES, inclusive = false) },
                onBack = { nav.backFrom(entry) },
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
                onRemove = { member -> vm.removeMember(member) { nav.backFrom(entry) } },
                onClearNotice = vm::clearNotice,
                onBack = { nav.backFrom(entry) },
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
                onOpenRole = { nav.openFrom(entry, Routes.roleRoute(classId, it)) },
                onNewRole = { nav.openFrom(entry, Routes.roleRoute(classId, Routes.NEW_ROLE)) },
                onClearNotice = vm::clearNotice,
                onBack = { nav.backFrom(entry) },
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
                onSave = { role -> vm.saveRole(role) { nav.backFrom(entry) } },
                onDelete = { role -> vm.deleteRole(role) { nav.backFrom(entry) } },
                onClearNotice = vm::clearNotice,
                onBack = { nav.backFrom(entry) },
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
                    onSave = { charge, paidTo, date -> vm.addPayout(charge, paidTo, date) { nav.backFrom(entry) } },
                    onClearNotice = vm::clearNotice,
                    onBack = { nav.backFrom(entry) },
                )
            } else {
                RecordFormScreen(
                    state = state,
                    type = type,
                    busy = busy,
                    notice = notice,
                    onSave = { record -> vm.addRecord(record) { nav.backFrom(entry) } },
                    onClearNotice = vm::clearNotice,
                    onBack = { nav.backFrom(entry) },
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
                    vm.chargeStudents(preview, note, courseId, date, payNow, paidTo) { nav.backFrom(entry) }
                },
                onClearNotice = vm::clearNotice,
                onBack = { nav.backFrom(entry) },
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
                onSave = { item -> vm.saveContent(item) { nav.backFrom(entry) } },
                onDelete = { item -> vm.deleteContent(item) { nav.backFrom(entry) } },
                onError = vm::showNotice,
                onClearNotice = vm::clearNotice,
                onBack = { nav.backFrom(entry) },
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
                onSave = { item -> vm.saveScheduleItem(item) { nav.backFrom(entry) } },
                onDelete = { item -> vm.deleteScheduleItem(item) { nav.backFrom(entry) } },
                onClearNotice = vm::clearNotice,
                onBack = { nav.backFrom(entry) },
            )
        }
        composable(Routes.MY_SETTINGS) { entry ->
            val classId = entry.arguments?.getString("classId").orEmpty()
            val vm = classViewModel(nav, entry, user)
            val state by vm.state.collectAsState()
            val busy by vm.busy.collectAsState()
            val notice by vm.notice.collectAsState()
            val context = LocalContext.current
            MySettingsScreen(
                state = state,
                classId = classId,
                myUid = user.uid,
                busy = busy,
                notice = notice,
                onClearNotice = vm::clearNotice,
                onLeave = { newMayorUid ->
                    val className = state.room?.name.orEmpty()
                    vm.leaveClass(newMayorUid) {
                        AppSettings.setPinned(classId, false)
                        Toast.makeText(context, "You left $className.", Toast.LENGTH_SHORT).show()
                        nav.popBackStack(Routes.CLASSES, inclusive = false)
                    }
                },
                onBack = { nav.backFrom(entry) },
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
                onSave = { room -> vm.saveSettings(room) { nav.backFrom(entry) } },
                onSetClassPhoto = vm::setClassPhoto,
                onRemoveClassPhoto = vm::removeClassPhoto,
                onPhotoError = vm::showNotice,
                onClearNotice = vm::clearNotice,
                onBack = { nav.backFrom(entry) },
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
                onBack = { nav.backFrom(entry) },
            )
        }
    }
}
