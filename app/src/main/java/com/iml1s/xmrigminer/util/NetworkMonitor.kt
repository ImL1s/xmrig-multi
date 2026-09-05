package com.iml1s.xmrigminer.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Monitors network connectivity and type
 */
@Singleton
class NetworkMonitor @Inject constructor(
    @ApplicationContext private val context: Context
) {
    
    enum class NetworkType {
        NONE,       // No connection
        WIFI,       // Wi-Fi
        MOBILE,     // Cellular data
        ETHERNET,   // Wired ethernet
        UNKNOWN     // Connected but type unknown
    }
    
    /**
     * Check if device has a network transport (Wi‑Fi/cellular/ethernet),
     * even without a validated Internet capability (LAN-only nodes).
     */
    fun hasNetworkTransport(): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = cm.activeNetwork ?: return false
                val capabilities = cm.getNetworkCapabilities(network) ?: return false
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
            } else {
                @Suppress("DEPRECATION")
                cm.activeNetworkInfo?.isConnected == true
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to check network transport")
            false
        }
    }

    /**
     * Check if device is connected to any network with Internet capability
     */
    fun isConnected(): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = cm.activeNetwork ?: return false
                val capabilities = cm.getNetworkCapabilities(network) ?: return false
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            } else {
                @Suppress("DEPRECATION")
                cm.activeNetworkInfo?.isConnected == true
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to check network connectivity")
            false
        }
    }
    
    /**
     * Get current network type
     */
    fun getNetworkType(): NetworkType {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return NetworkType.NONE
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val capabilities = cm.getNetworkCapabilities(cm.activeNetwork)
                    ?: return NetworkType.NONE
                
                when {
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkType.WIFI
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkType.MOBILE
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkType.ETHERNET
                    else -> NetworkType.UNKNOWN
                }
            } else {
                @Suppress("DEPRECATION")
                when (cm.activeNetworkInfo?.type) {
                    ConnectivityManager.TYPE_WIFI -> NetworkType.WIFI
                    ConnectivityManager.TYPE_MOBILE -> NetworkType.MOBILE
                    ConnectivityManager.TYPE_ETHERNET -> NetworkType.ETHERNET
                    null -> NetworkType.NONE
                    else -> NetworkType.UNKNOWN
                }
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to get network type")
            NetworkType.NONE
        }
    }
    
    /**
     * Check if connected to Wi-Fi specifically
     */
    fun isWifiConnected(): Boolean {
        return getNetworkType() == NetworkType.WIFI
    }
    
    /**
     * Check if using mobile data
     */
    fun isMobileDataConnected(): Boolean {
        return getNetworkType() == NetworkType.MOBILE
    }
    
    /**
     * Get user-friendly network type string
     */
    fun getNetworkTypeString(): String {
        return when (getNetworkType()) {
            NetworkType.NONE -> "No Connection"
            NetworkType.WIFI -> "Wi-Fi"
            NetworkType.MOBILE -> "Mobile Data"
            NetworkType.ETHERNET -> "Ethernet"
            NetworkType.UNKNOWN -> "Unknown"
        }
    }
}
