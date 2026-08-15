package kr.co.catharsis.owner.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kr.co.catharsis.owner.MainViewModel
import kr.co.catharsis.owner.data.BookingAlert
import kr.co.catharsis.owner.data.ConnectionState
import kr.co.catharsis.owner.data.formatCreatedAt
import kr.co.catharsis.owner.data.paymentStatusLabel
import kr.co.catharsis.owner.data.toWon
import java.time.LocalDate

@Composable
fun OwnerApp(
    viewModel: MainViewModel,
    defaultDeviceName: String,
    onPaired: () -> Unit,
) {
    val isPaired by viewModel.isPaired.collectAsStateWithLifecycle()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        if (isPaired) {
            ReservationsScreen(viewModel)
        } else {
            PairingScreen(viewModel, defaultDeviceName, onPaired)
        }
    }
}

@Composable
private fun PairingScreen(
    viewModel: MainViewModel,
    defaultDeviceName: String,
    onPaired: () -> Unit,
) {
    var accessKey by remember { mutableStateOf("") }
    var deviceName by remember { mutableStateOf(defaultDeviceName) }
    val connection by viewModel.connection.collectAsStateWithLifecycle()
    val pairingError by viewModel.pairingError.collectAsStateWithLifecycle()
    val isBusy = connection is ConnectionState.Syncing
    val focusManager = LocalFocusManager.current

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.statusBars)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .imePadding()
                .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        BrandMark()
        Spacer(Modifier.height(30.dp))
        Text(
            text = "CATHARSIS",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.secondary,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "예약 운영",
            style = MaterialTheme.typography.displaySmall,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = "매장 전용 장치를 연결합니다.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = accessKey,
            onValueChange = { accessKey = it },
            modifier = Modifier.fillMaxWidth(),
            enabled = !isBusy,
            label = { Text("운영 키") },
            leadingIcon = { Icon(Icons.Rounded.Key, contentDescription = null) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Next,
                ),
            keyboardActions =
                KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) },
                ),
            shape = RoundedCornerShape(18.dp),
        )
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(
            value = deviceName,
            onValueChange = { deviceName = it },
            modifier = Modifier.fillMaxWidth(),
            enabled = !isBusy,
            label = { Text("장치 이름") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions =
                KeyboardActions(
                    onDone = {
                        focusManager.clearFocus()
                        if (accessKey.isNotBlank() && deviceName.isNotBlank()) {
                            viewModel.pair(accessKey, deviceName, onPaired)
                        }
                    },
                ),
            shape = RoundedCornerShape(18.dp),
        )

        AnimatedVisibility(pairingError != null) {
            Text(
                text = pairingError.orEmpty(),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 12.dp, start = 4.dp),
            )
        }
        Spacer(Modifier.height(22.dp))
        Button(
            onClick = {
                focusManager.clearFocus()
                viewModel.pair(accessKey, deviceName, onPaired)
            },
            enabled = accessKey.isNotBlank() && deviceName.isNotBlank() && !isBusy,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(56.dp),
            shape = RoundedCornerShape(18.dp),
        ) {
            if (isBusy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.5.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text("이 장치 연결", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun BrandMark() {
    val primary = MaterialTheme.colorScheme.primary
    val secondary = MaterialTheme.colorScheme.secondary
    Canvas(modifier = Modifier.size(66.dp)) {
        drawCircle(color = secondary, style = Stroke(width = 3.dp.toPx()))
        drawArc(
            color = primary,
            startAngle = -55f,
            sweepAngle = 245f,
            useCenter = false,
            style = Stroke(width = 7.dp.toPx(), cap = StrokeCap.Round),
        )
        drawCircle(color = primary, radius = 7.dp.toPx())
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReservationsScreen(viewModel: MainViewModel) {
    val alerts by viewModel.alerts.collectAsStateWithLifecycle()
    val connection by viewModel.connection.collectAsStateWithLifecycle()
    val selectedAlertId by viewModel.selectedAlertId.collectAsStateWithLifecycle()
    var menuExpanded by remember { mutableStateOf(false) }
    var showDisconnectDialog by remember { mutableStateOf(false) }
    val selectedAlert = alerts.firstOrNull { it.id == selectedAlertId }

    LaunchedEffect(selectedAlertId, alerts.size) {
        if (selectedAlertId != null && selectedAlert == null && alerts.isNotEmpty()) {
            viewModel.selectAlert(null)
        }
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("예약 알림", style = MaterialTheme.typography.titleLarge)
                        ConnectionLabel(connection)
                    }
                },
                actions = {
                    IconButton(
                        onClick = viewModel::refresh,
                        enabled = connection !is ConnectionState.Syncing,
                    ) {
                        if (connection is ConnectionState.Syncing) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Rounded.Refresh, contentDescription = "새로고침")
                        }
                    }
                    Box {
                        IconButton(onClick = { menuExpanded = true }) {
                            Icon(Icons.Rounded.MoreVert, contentDescription = "메뉴")
                        }
                        DropdownMenu(
                            expanded = menuExpanded,
                            onDismissRequest = { menuExpanded = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("이 기기 연결 해제") },
                                onClick = {
                                    menuExpanded = false
                                    showDisconnectDialog = true
                                },
                            )
                        }
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background,
                    ),
            )
        },
    ) { padding ->
        if (alerts.isEmpty()) {
            EmptyReservations(
                modifier =
                    Modifier
                        .padding(padding)
                        .fillMaxSize(),
                isLoading = connection is ConnectionState.Syncing,
            )
        } else {
            AlertTimeline(
                alerts = alerts,
                onSelect = viewModel::selectAlert,
                modifier = Modifier.padding(padding),
            )
        }
    }

    if (selectedAlert != null) {
        ReservationDetails(
            alert = selectedAlert,
            onDismiss = { viewModel.selectAlert(null) },
        )
    }

    if (showDisconnectDialog) {
        AlertDialog(
            onDismissRequest = { showDisconnectDialog = false },
            title = { Text("이 기기의 연결을 해제할까요?") },
            text = { Text("저장된 예약 내역과 장치 토큰이 이 기기에서 삭제됩니다.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDisconnectDialog = false
                        viewModel.disconnect()
                    },
                ) { Text("연결 해제", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showDisconnectDialog = false }) { Text("취소") }
            },
        )
    }
}

@Composable
private fun ConnectionLabel(connection: ConnectionState) {
    val (label, color) =
        when (connection) {
            is ConnectionState.Connected -> "연결됨" to Color(0xFF3C8B62)
            ConnectionState.Syncing -> "확인 중" to MaterialTheme.colorScheme.secondary
            is ConnectionState.Error -> "연결 재시도 중" to MaterialTheme.colorScheme.error
            ConnectionState.Idle -> "연결됨" to Color(0xFF3C8B62)
            ConnectionState.PairingRequired -> "연결 필요" to MaterialTheme.colorScheme.error
        }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(color),
        )
        Spacer(Modifier.size(6.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = color)
    }
}

@Composable
private fun AlertTimeline(
    alerts: List<BookingAlert>,
    onSelect: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val unreadCount = alerts.count { !it.isRead }
    val today = LocalDate.now().toString()
    val todayCount = alerts.count { it.reservation.serviceDate == today }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 10.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SummaryPanel(todayCount = todayCount, unreadCount = unreadCount)
        }
        item {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 10.dp, start = 2.dp, end = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("전체 예약", style = MaterialTheme.typography.titleMedium)
                Text(
                    "${alerts.size}건",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(alerts, key = { it.id }) { alert ->
            AlertCard(alert = alert, onClick = { onSelect(alert.id) })
        }
    }
}

@Composable
private fun SummaryPanel(
    todayCount: Int,
    unreadCount: Int,
) {
    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 22.dp, vertical = 20.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            SummaryValue(label = "오늘 예약", value = "${todayCount}건")
            Box(
                Modifier
                    .size(width = 1.dp, height = 48.dp)
                    .background(MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.18f)),
            )
            SummaryValue(label = "읽지 않음", value = "${unreadCount}건")
        }
    }
}

@Composable
private fun SummaryValue(
    label: String,
    value: String,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 12.dp)) {
        Text(
            value,
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.72f),
        )
    }
}

@Composable
private fun AlertCard(
    alert: BookingAlert,
    onClick: () -> Unit,
) {
    val reservation = alert.reservation
    Card(
        modifier =
            Modifier
                .fillMaxWidth()
                .shadow(2.dp, RoundedCornerShape(20.dp), ambientColor = Color.Black.copy(alpha = 0.08f))
                .clickable(onClick = onClick),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(modifier = Modifier.padding(18.dp), verticalAlignment = Alignment.Top) {
            Box(
                modifier =
                    Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(
                            if (alert.isRead) {
                                MaterialTheme.colorScheme.surfaceVariant
                            } else {
                                MaterialTheme.colorScheme.primaryContainer
                            },
                        ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Notifications,
                    contentDescription = null,
                    tint =
                        if (alert.isRead) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                )
            }
            Spacer(Modifier.size(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        reservation.themeName,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (!alert.isRead) {
                        Spacer(Modifier.size(8.dp))
                        Box(
                            Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                        )
                    }
                }
                Spacer(Modifier.height(5.dp))
                Text(
                    "${reservation.serviceDate}  ${reservation.time} · ${reservation.partySize}명",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        reservation.bookingCode,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        formatCreatedAt(alert.createdAt),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptyReservations(
    modifier: Modifier = Modifier,
    isLoading: Boolean,
) {
    Column(
        modifier = modifier.padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier =
                Modifier
                    .size(74.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            if (isLoading) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.5.dp)
            } else {
                Icon(
                    Icons.Rounded.Notifications,
                    contentDescription = null,
                    modifier = Modifier.size(30.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
        }
        Spacer(Modifier.height(20.dp))
        Text(
            if (isLoading) "예약을 확인하고 있습니다" else "새 예약을 기다리고 있습니다",
            style = MaterialTheme.typography.titleLarge,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "결제가 완료된 예약이 이곳에 표시됩니다.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReservationDetails(
    alert: BookingAlert,
    onDismiss: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val reservation = alert.reservation

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        contentWindowInsets = { WindowInsets.navigationBars },
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "예약 상세",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        reservation.themeName,
                        style = MaterialTheme.typography.headlineMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Rounded.Close, contentDescription = "닫기")
                }
            }
            Spacer(Modifier.height(18.dp))

            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(
                            "예약번호",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
                        )
                        Text(
                            reservation.bookingCode,
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                    IconButton(
                        onClick = { clipboard.setText(AnnotatedString(reservation.bookingCode)) },
                    ) {
                        Icon(Icons.Rounded.ContentCopy, contentDescription = "예약번호 복사")
                    }
                }
            }
            Spacer(Modifier.height(22.dp))
            DetailRow("이용 일시", "${reservation.serviceDate}  ${reservation.time}")
            DetailRow("예약 인원", "${reservation.partySize}명")
            DetailRow("예약자", reservation.name)
            DetailRow("휴대전화", reservation.phone)
            DetailRow("결제금액", reservation.amount.toWon())
            DetailRow("결제상태", reservation.paymentStatus.paymentStatusLabel(), divider = false)
            Spacer(Modifier.height(16.dp))
            FilledTonalButton(
                onClick = onDismiss,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                shape = RoundedCornerShape(16.dp),
                colors =
                    ButtonDefaults.filledTonalButtonColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
            ) {
                Text("확인")
            }
        }
    }
}

@Composable
private fun DetailRow(
    label: String,
    value: String,
    divider: Boolean = true,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 13.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
    if (divider) HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.18f))
}
