package com.seanxxotick.classhub.ui

import androidx.compose.foundation.layout.Box
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
import com.seanxxotick.classhub.ui.auth.AuthScreen
import com.seanxxotick.classhub.ui.auth.AuthViewModel
import com.seanxxotick.classhub.ui.auth.Session
import com.seanxxotick.classhub.ui.classes.ClassesScreen
import com.seanxxotick.classhub.ui.classes.ClassesViewModel
import com.seanxxotick.classhub.ui.classes.CreateClassScreen
import com.seanxxotick.classhub.ui.classes.JoinClassScreen
import com.seanxxotick.classhub.ui.classroom.ClassScreen
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
    ClassHubTheme {
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

private object Routes {
    const val CLASSES = "classes"
    const val CREATE = "create"
    const val JOIN = "join"
    const val CLASS = "class/{classId}"
    const val MEMBER = "class/{classId}/member/{memberId}"
    const val ROLES = "class/{classId}/roles"
    const val ROLE = "class/{classId}/roles/{roleId}"
    const val COURSES = "class/{classId}/courses"
    const val NEW_ROLE = "new"

    fun classRoute(classId: String) = "class/$classId"
    fun memberRoute(classId: String, memberId: String) = "class/$classId/member/$memberId"
    fun rolesRoute(classId: String) = "class/$classId/roles"
    fun roleRoute(classId: String, roleId: String) = "class/$classId/roles/$roleId"
    fun coursesRoute(classId: String) = "class/$classId/courses"
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
            val action by classesVm.action.collectAsState()
            ClassesScreen(
                user = user,
                classes = classes,
                error = action.error,
                onOpenClass = { nav.navigate(Routes.classRoute(it)) },
                onCreate = { classesVm.clearError(); nav.navigate(Routes.CREATE) },
                onJoin = { classesVm.clearError(); nav.navigate(Routes.JOIN) },
                onSignOut = onSignOut,
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
            ClassScreen(
                state = state,
                myUid = user.uid,
                busy = busy,
                notice = notice,
                onRegenerateCode = vm::regenerateInviteCode,
                onOpenMember = { nav.navigate(Routes.memberRoute(classId, it)) },
                onOpenRoles = { nav.navigate(Routes.rolesRoute(classId)) },
                onOpenCourses = { nav.navigate(Routes.coursesRoute(classId)) },
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
