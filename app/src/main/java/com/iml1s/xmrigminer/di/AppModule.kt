package com.iml1s.xmrigminer.di

import android.content.Context
import androidx.work.WorkManager
import com.iml1s.xmrigminer.data.energy.EnergyLedgerStore
import com.iml1s.xmrigminer.data.energy.SqliteEnergyLedgerStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideWorkManager(
        @ApplicationContext context: Context
    ): WorkManager = WorkManager.getInstance(context)

    @Provides
    @Singleton
    fun provideEnergyLedgerStore(
        @ApplicationContext context: Context
    ): EnergyLedgerStore = SqliteEnergyLedgerStore(context)
}
