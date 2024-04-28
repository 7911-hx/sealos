import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiResp } from '@/services/kubernet';
import { authSession } from '@/services/backend/auth';
import { getK8s } from '@/services/backend/kubernetes';
import { jsonRes } from '@/services/backend/response';
import { appDeployKey } from '@/constants/app';

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResp>) {
  try {
    const { appName } = req.query as { appName: string };
    if (!appName) {
      throw new Error('appName is empty');
    }
    const response = await GetAppByAppName({ appName, req });

    // Check for errors other than 404
    const responseData = response
      .map((item) => {
        if (item.status === 'fulfilled') return item.value.body;
        if (+item.reason?.body?.code === 404) return '';
        throw new Error('Get APP Deployment Error');
      })
      .filter((item) => item)
      .flat();

    jsonRes(res, {
      data: responseData
    });
  } catch (err: any) {
    jsonRes(res, {
      code: 500,
      error: err
    });
  }
}

export async function GetAppByAppName({
  appName,
  req
}: { appName: string } & { req: NextApiRequest }) {
  const reqNamespace = req.query.namespace as string;
  const { k8sApp, k8sCore, k8sNetworkingApp, k8sAutoscaling, namespace } = await getK8s({
    kubeconfig: await authSession(req.headers)
  });

  const response = await Promise.allSettled([
    k8sApp.readNamespacedDeployment(appName, reqNamespace),
    k8sApp.readNamespacedStatefulSet(appName, reqNamespace),
    k8sCore.readNamespacedService(appName, reqNamespace),
    k8sCore.readNamespacedConfigMap(appName, reqNamespace),
    k8sNetworkingApp
      .listNamespacedIngress(
        reqNamespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `${appDeployKey}=${appName}`
      )
      .then((res) => ({
        body: res.body.items.map((item) => ({
          ...item,
          apiVersion: res.body.apiVersion, // item does not contain apiversion and kind
          kind: 'Ingress'
        }))
      })),
    k8sCore.readNamespacedSecret(appName, reqNamespace),
    k8sAutoscaling.readNamespacedHorizontalPodAutoscaler(appName, reqNamespace)
  ]);

  return response;
}
