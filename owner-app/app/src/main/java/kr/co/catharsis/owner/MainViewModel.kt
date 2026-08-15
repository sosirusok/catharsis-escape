package kr.co.catharsis.owner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kr.co.catharsis.owner.data.AlertRepository

class MainViewModel(
    private val repository: AlertRepository,
) : ViewModel() {
    val alerts = repository.alerts
    val isPaired = repository.isPaired
    val connection = repository.connection

    private val _selectedAlertId = MutableStateFlow<Long?>(null)
    val selectedAlertId = _selectedAlertId.asStateFlow()

    private val _pairingError = MutableStateFlow<String?>(null)
    val pairingError = _pairingError.asStateFlow()

    fun pair(
        accessKey: String,
        deviceName: String,
        onSuccess: () -> Unit,
    ) {
        _pairingError.value = null
        viewModelScope.launch {
            runCatching { repository.pair(accessKey, deviceName) }
                .onSuccess { onSuccess() }
                .onFailure { _pairingError.value = it.message ?: "운영 키를 확인해 주세요." }
        }
    }

    fun refresh() {
        viewModelScope.launch { repository.sync(notifyNew = true) }
    }

    fun selectAlert(id: Long?) {
        _selectedAlertId.value = id
        if (id != null) viewModelScope.launch { repository.markRead(id) }
    }

    fun disconnect() {
        viewModelScope.launch { repository.disconnect() }
    }

    class Factory(
        private val repository: AlertRepository,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = MainViewModel(repository) as T
    }
}
