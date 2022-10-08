// Copyright 2022 @paritytech/polkadot-staking-dashboard authors & contributors
// SPDX-License-Identifier: Apache-2.0

import BN from 'bn.js';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useStaking } from 'contexts/Staking';
import { AnyApi, Sync } from 'types';
import {
  ActivePool,
  ActivePoolState,
  ActivePoolsContextState,
  BondedPool,
  PoolAddresses,
} from 'contexts/Pools/types';
import { rmCommas, localStorageOrDefault, setStateWithRef } from 'Utils';
import * as defaults from './defaults';
import { useApi } from '../../Api';
import { useConnect } from '../../Connect';
import { usePoolsConfig } from '../PoolsConfig';
import { usePoolMemberships } from '../PoolMemberships';
import { useBondedPools } from '../BondedPools';

export const ActivePoolsContext = React.createContext<ActivePoolsContextState>(
  defaults.defaultActivePoolContext
);

export const useActivePools = () => React.useContext(ActivePoolsContext);

export const ActivePoolsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { api, network, isReady, consts } = useApi();
  const { eraStakers } = useStaking();
  const { activeAccount } = useConnect();
  const { createAccounts } = usePoolsConfig();
  const { membership } = usePoolMemberships();
  const { getAccountPools, bondedPools } = useBondedPools();

  // determine active pools to subscribe to.
  const accountPools = useMemo(
    () => Object.keys(getAccountPools(activeAccount)),
    [activeAccount, bondedPools]
  );

  // stores member's active pools
  const [activePools, setActivePools] = useState<ActivePoolState>(null);
  const activePoolsRef = useRef(activePools);

  // store active pools unsubs
  const [unsubActivePools, setUnsubActivePools] = useState<Array<AnyApi>>([]);
  const unsubActivePoolsRef = useRef(unsubActivePools);

  // store active pools nominations.
  const [poolNominations, setPoolNominations] = useState<any>(
    defaults.poolNominations
  );
  const poolNominationsRef = useRef(poolNominations);

  // store pool nominations unsubs
  const [unsubNominations, setUnsubNominations] = useState<Array<AnyApi>>([]);
  const unsubNominationsRef = useRef(unsubNominations);

  // store account target validators
  const [targets, _setTargets] = useState<any>(defaults.targets);
  const targetsRef = useRef(targets);

  // store whether active pool data has been synced.
  // this will be true if no active pool exists for the active account.
  // We just need confirmation this is the case.
  const [synced, setSynced] = useState<Sync>(Sync.Unsynced);
  const syncedRef = useRef(synced);

  // store the currently selected active pool for the UI.
  // Should default to the membership pool (if present).
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);

  // re-sync when accountPools change.
  useEffect(() => {
    if (unsubActivePoolsRef.current.length) {
      unsubscribeActivePools();
    }
    if (unsubNominationsRef.current.length) {
      unsubscribePoolNominations();
    }
    setStateWithRef(Sync.Unsynced, setSynced, syncedRef);
  }, [accountPools]);

  // subscribe to pool that the active account is a member of.
  useEffect(() => {
    if (isReady && synced === Sync.Unsynced) {
      setStateWithRef(Sync.Syncing, setSynced, syncedRef);
      handlePoolSubscriptions();
    }
  }, [network, isReady, syncedRef.current]);

  const getActivePoolMembership = () => {
    // TODO: get the activePool that the active account
    // is a member of, or return null.
    return activePoolsRef.current;
  };

  const getSelectedActivePool = () => {
    // TODO: get the currently selected active pool.
    return activePoolsRef.current;
  };

  const getSelectedPoolTargets = () => {
    // TODO: get the currently selected active pool's targets
    // TODO: return defaults if not present in array.
    return targetsRef.current;
  };

  const getSelectedPoolNominations = () => {
    // TODO: get the currently selected active pool's nominations.
    // TODO: return defaults if not present in array.
    return poolNominationsRef.current;
  };

  // unsubscribe all on component unmount
  useEffect(() => {
    return () => {
      unsubscribeActivePools();
      unsubscribePoolNominations();
    };
  }, [network]);

  // re-calculate unclaimed payout when membership changes
  useEffect(() => {
    const acitvePoolMembership = getActivePoolMembership();
    if (acitvePoolMembership && membership && isReady) {
      const unclaimedRewards = calculatePayout(
        acitvePoolMembership.bondedPool ?? defaults.bondedPool,
        acitvePoolMembership.rewardPool ?? defaults.rewardPool,
        acitvePoolMembership.rewardAccountBalance ?? new BN(0)
      );
      updateUnclaimedRewards(unclaimedRewards, acitvePoolMembership);
    }
  }, [
    network,
    isReady,
    getActivePoolMembership()?.bondedPool,
    getActivePoolMembership()?.rewardPool,
    membership,
  ]);

  // handle active pool subscriptions
  const handlePoolSubscriptions = async () => {
    if (accountPools.length) {
      Promise.all(accountPools.map((p) => subscribeToActivePool(Number(p))));
    } else {
      setStateWithRef(Sync.Synced, setSynced, syncedRef);
    }

    // assign default pool immediately
    const defaultSelected = membership?.poolId || accountPools[0] || null;
    if (defaultSelected) {
      setSelectedPoolId(String(defaultSelected));
    }
  };

  // unsubscribe and reset poolNominations
  const unsubscribePoolNominations = () => {
    if (unsubNominationsRef.current.length) {
      for (const unsub of unsubNominationsRef.current) {
        unsub();
      }
    }
    setStateWithRef(
      defaults.poolNominations,
      setPoolNominations,
      poolNominationsRef
    );
    setStateWithRef([], setUnsubNominations, unsubNominationsRef);
  };

  // unsubscribe and reset activePool and poolNominations
  const unsubscribeActivePools = () => {
    if (unsubActivePoolsRef.current.length) {
      for (const unsub of unsubActivePoolsRef.current) {
        unsub();
      }
      setStateWithRef(null, setActivePools, activePoolsRef);
      setStateWithRef([], setUnsubActivePools, unsubActivePoolsRef);
    }
  };

  const subscribeToActivePool = async (poolId: number) => {
    if (!api) {
      return;
    }

    const addresses: PoolAddresses = createAccounts(poolId);

    // new active pool subscription
    const subscribeActivePool = async (_poolId: number) => {
      const unsub: () => void = await api.queryMulti<[AnyApi, AnyApi, AnyApi]>(
        [
          [api.query.nominationPools.bondedPools, _poolId],
          [api.query.nominationPools.rewardPools, _poolId],
          [api.query.system.account, addresses.reward],
        ],
        async ([bondedPool, rewardPool, accountData]): Promise<void> => {
          const balance = accountData.data;
          bondedPool = bondedPool?.unwrapOr(undefined)?.toHuman();
          rewardPool = rewardPool?.unwrapOr(undefined)?.toHuman();

          if (rewardPool && bondedPool) {
            const rewardAccountBalance = balance?.free;
            const unclaimedRewards = calculatePayout(
              bondedPool,
              rewardPool,
              rewardAccountBalance
            );

            const pool = {
              id: _poolId,
              addresses,
              bondedPool,
              rewardPool,
              rewardAccountBalance,
              unclaimedRewards,
            };

            // set active pool state
            setStateWithRef(pool, setActivePools, activePoolsRef);

            // get pool target nominations and set in state
            const _targets = localStorageOrDefault(
              `${addresses.stash}_pool_targets`,
              defaults.targets,
              true
            );

            // set pool staking targets
            setStateWithRef(_targets, _setTargets, targetsRef);

            // subscribe to pool nominations
            subscribeToPoolNominations(addresses.stash);
          } else {
            setStateWithRef(defaults.targets, _setTargets, targetsRef);
          }
        }
      );
      return unsub;
    };

    // initiate subscription, add to unsubs.
    await Promise.all([subscribeActivePool(poolId)]).then((unsubs: any) => {
      setStateWithRef(
        [...unsubActivePoolsRef.current, ...unsubs],
        setUnsubActivePools,
        unsubActivePoolsRef
      );
    });
  };

  const subscribeToPoolNominations = async (poolBondAddress: string) => {
    if (!api) return;

    const subscribePoolNominations = async (_poolBondAddress: string) => {
      const unsub = await api.query.staking.nominators(
        _poolBondAddress,
        (nominations: AnyApi) => {
          // set pool nominations
          let _nominations = nominations.unwrapOr(null);
          if (_nominations === null) {
            _nominations = defaults.poolNominations;
          } else {
            _nominations = {
              targets: _nominations.targets.toHuman(),
              submittedIn: _nominations.submittedIn.toHuman(),
            };
          }
          // set pool nominations state
          setStateWithRef(_nominations, setPoolNominations, poolNominationsRef);

          // update sycning to complete
          setStateWithRef(Sync.Synced, setSynced, syncedRef);
        }
      );
      return unsub;
    };

    // initiate subscription, add to unsubs.
    await Promise.all([subscribePoolNominations(poolBondAddress)]).then(
      (unsubs: any) => {
        setStateWithRef(
          [...unsubNominationsRef.current, ...unsubs],
          setUnsubNominations,
          unsubNominationsRef
        );
      }
    );
  };

  // Utility functions
  /*
   * updateUnclaimedRewards
   * A helper function to set the unclaimed rewards of an active pool.
   */
  const updateUnclaimedRewards = (amount: BN, pool: ActivePool) => {
    // TODO: update the active pool the account is a member of
    if (pool !== null) {
      setStateWithRef(
        {
          ...pool,
          unclaimedRewards: amount,
        },
        setActivePools,
        activePoolsRef
      );
    }
  };

  /*
   * setTargets
   * Sets pools target validators in storage.
   */
  const setTargets = (_targets: any) => {
    const stashAddress = getPoolBondedAccount();
    if (stashAddress) {
      localStorage.setItem(
        `${stashAddress}_pool_targets`,
        JSON.stringify(_targets)
      );
      setStateWithRef(_targets, _setTargets, targetsRef);
    }
  };

  /*
   * isBonding
   * Returns whether active pool exists
   */
  const isBonding = () => {
    return !!getSelectedActivePool();
  };

  /*
   * isNominator
   * Returns whether the active account is
   * the nominator in the active pool.
   */
  const isNominator = () => {
    const roles = getSelectedActivePool()?.bondedPool?.roles;
    if (!activeAccount || !roles) {
      return false;
    }
    const result =
      activeAccount === roles?.root || activeAccount === roles?.nominator;
    return result;
  };

  /*
   * isOwner
   * Returns whether the active account is
   * the owner of the active pool.
   */
  const isOwner = () => {
    const roles = getSelectedActivePool()?.bondedPool?.roles;
    if (!activeAccount || !roles) {
      return false;
    }
    const result =
      activeAccount === roles?.root || activeAccount === roles?.stateToggler;
    return result;
  };

  /*
   * isDepositor
   * Returns whether the active account is
   * the depositor of the active pool.
   */
  const isDepositor = () => {
    const roles = getSelectedActivePool()?.bondedPool?.roles;
    if (!activeAccount || !roles) {
      return false;
    }
    const result = activeAccount === roles?.depositor;
    return result;
  };

  /*
   * isStateToggler
   * Returns whether the active account is
   * the depositor of the active pool.
   */
  const isStateToggler = () => {
    const roles = getSelectedActivePool()?.bondedPool?.roles;
    if (!activeAccount || !roles) {
      return false;
    }
    const result = activeAccount === roles?.stateToggler;
    return result;
  };

  /*
   * getPoolBondedAccount
   * get the stash address of the bonded pool
   * that the member is participating in.
   */
  const getPoolBondedAccount = () => {
    return getSelectedActivePool()?.addresses?.stash || null;
  };

  /*
   * Get the status of nominations.
   * Possible statuses: waiting, inactive, active.
   */
  const getNominationsStatus = () => {
    const nominations = getSelectedPoolNominations().nominations?.targets || [];
    const statuses: { [key: string]: string } = {};

    for (const nomination of nominations) {
      const s = eraStakers.stakers.find((_n: any) => _n.address === nomination);

      if (s === undefined) {
        statuses[nomination] = 'waiting';
        continue;
      }
      const exists = (s.others ?? []).find(
        (_o: any) => _o.who === activeAccount
      );
      if (exists === undefined) {
        statuses[nomination] = 'inactive';
        continue;
      }
      statuses[nomination] = 'active';
    }
    return statuses;
  };

  /*
   * getPoolRoles
   * Returns the active pool's roles or a default roles object.
   */
  const getPoolRoles = () => {
    const roles = getSelectedActivePool()?.bondedPool?.roles ?? null;
    if (!roles) {
      return defaults.poolRoles;
    }
    return roles;
  };

  const getPoolUnlocking = () => {
    return membership?.unlocking || [];
  };

  const calculatePayout = (
    bondedPool: BondedPool,
    rewardPool: any,
    rewardAccountBalance: BN
  ): BN => {
    if (!membership) return new BN(0);

    const rewardCounterBase = new BN(10).pow(new BN(18));

    // convert needed values into BNs
    const totalRewardsClaimed = new BN(
      rmCommas(rewardPool.totalRewardsClaimed)
    );
    const lastRecordedTotalPayouts = new BN(
      rmCommas(rewardPool.lastRecordedTotalPayouts)
    );
    const memberLastRecordedRewardCounter = new BN(
      rmCommas(membership.lastRecordedRewardCounter)
    );
    const poolLastRecordedRewardCounter = new BN(
      rmCommas(rewardPool.lastRecordedRewardCounter)
    );
    const bondedPoolPoints = new BN(rmCommas(bondedPool.points));
    const points = new BN(rmCommas(membership.points));

    // calculate the latest reward account balance minus the existential deposit
    const rewardPoolBalance = BN.max(
      new BN(0),
      new BN(rewardAccountBalance).sub(consts.existentialDeposit)
    );

    // calculate the current reward counter
    const payoutsSinceLastRecord = rewardPoolBalance
      .add(totalRewardsClaimed)
      .sub(lastRecordedTotalPayouts);

    const currentRewardCounter = (
      bondedPoolPoints.eq(new BN(0))
        ? new BN(0)
        : payoutsSinceLastRecord.mul(rewardCounterBase).div(bondedPoolPoints)
    ).add(poolLastRecordedRewardCounter);

    const pendingRewards = currentRewardCounter
      .sub(memberLastRecordedRewardCounter)
      .mul(points)
      .div(rewardCounterBase);

    return pendingRewards;
  };

  return (
    <ActivePoolsContext.Provider
      value={{
        isNominator,
        isOwner,
        isDepositor,
        isStateToggler,
        isBonding,
        getPoolBondedAccount,
        getPoolUnlocking,
        getPoolRoles,
        setTargets,
        getNominationsStatus,
        setSelectedPoolId,
        synced: syncedRef.current,
        selectedActivePool: getSelectedActivePool(),
        targets: getSelectedPoolTargets(),
        poolNominations: getSelectedPoolNominations(),
      }}
    >
      {children}
    </ActivePoolsContext.Provider>
  );
};
